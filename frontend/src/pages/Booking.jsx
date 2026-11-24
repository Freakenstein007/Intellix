import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BatteryCharging, Check, Clock3, MapPin, QrCode, ShieldAlert, Sparkles, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAmpwise } from '../App.jsx';
import { api } from '../api.js';
import '../booking.css';

const nowLocal = (minutes = 45) => {
  const date = new Date(Date.now() + minutes * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const initialForm = () => ({ reg: '', route_name: 'Chennai–Tiruchirappalli', emergency_flag: false, vehicle_type: 'bus', model: '', battery_capacity_kwh: 350, connector_type: 'CCS2', range_km: 85, distance_to_next_station_km: 20, battery_pct: 25, target_pct: 80, station_id: '', preferred_arrival: nowLocal(45) });

const ROUTES = [
  { name: 'Chennai–Tiruchirappalli', label: 'Chennai → Tiruchirappalli → Madurai', cities: ['Chennai', 'Tiruchirappalli', 'Madurai'] },
  { name: 'Chennai–Salem', label: 'Chennai → Salem → Coimbatore', cities: ['Chennai', 'Salem', 'Coimbatore'] },
  { name: 'Coimbatore–Madurai', label: 'Coimbatore → Tiruchirappalli → Madurai', cities: ['Coimbatore', 'Tiruchirappalli', 'Madurai'] },
  { name: 'Tamil Nadu Regional', label: 'Tamil Nadu regional network', cities: ['Chennai', 'Salem', 'Coimbatore', 'Tiruchirappalli', 'Madurai'] },
];

const kmBetween = (a, b) => {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h)) * 1.15; // straight-line distance plus a road-route factor
};

function InputField({ label, value, onChange, type = 'number', min, max, step = 'any', suffix, help }) {
  return <label className="form-field"><span className="field-label">{label}</span><span className="input-shell"><input type={type} value={value} min={min} max={max} step={step} onChange={event => onChange(event.target.value)} required={type !== 'datetime-local'} /><small>{suffix}</small></span>{help && <small className="field-help">{help}</small>}</label>;
}

export default function BookingPage() {
  const { stations, user, refresh, notify } = useAmpwise();
  const { t } = useTranslation();
  const [form, setForm] = useState(initialForm);
  const [estimate, setEstimate] = useState(null);
  const [lookup, setLookup] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [alternatives, setAlternatives] = useState([]);
  const [lookupState, setLookupState] = useState('');
  const selectedStation = stations.find(station => station.id === Number(form.station_id));
  const healthyStations = stations.filter(station => !station.is_faulty);
  const route = ROUTES.find(item => item.name === form.route_name) || ROUTES[0];
  const routeDistances = new Map();
  let accumulated = 0;
  route.cities.forEach((city, index) => {
    if (index > 0) {
      const previousStation = stations.find(item => item.city === route.cities[index - 1]);
      const currentStation = stations.find(item => item.city === city);
      if (previousStation && currentStation) accumulated += kmBetween(previousStation, currentStation);
    }
    routeDistances.set(city, Number(form.distance_to_next_station_km) + accumulated);
  });
  const routeOrigin = stations.find(item => item.city === route.cities[0]);
  const rankedStations = healthyStations.map(station => {
    const onRoute = routeDistances.has(station.city);
    const routeDistance = onRoute ? routeDistances.get(station.city) : routeOrigin ? Number(form.distance_to_next_station_km) + kmBetween(routeOrigin, station) : Number.POSITIVE_INFINITY;
    return { ...station, onRoute, routeDistance, reachable: routeDistance <= Number(form.range_km) };
  }).sort((a, b) => (b.onRoute && b.reachable) - (a.onRoute && a.reachable) || a.routeDistance - b.routeDistance);
  const recommendedStations = rankedStations.filter(station => station.onRoute && station.reachable);
  const otherStations = rankedStations.filter(station => !(station.onRoute && station.reachable));
  const selectedRanking = rankedStations.find(station => station.id === Number(form.station_id));
  const ready = form.station_id && form.reg.length >= 3 && form.model.length >= 2 && form.battery_pct < form.target_pct && form.distance_to_next_station_km > 0;

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const estimatePayload = useMemo(() => ({
    operator_id: user.id, station_id: Number(form.station_id), reg: form.reg || 'NEW-BUS',
    range_km: Number(form.range_km), distance_to_next_station_km: Number(form.distance_to_next_station_km),
    battery_pct: Number(form.battery_pct), target_pct: Number(form.target_pct), battery_capacity_kwh: Number(form.battery_capacity_kwh),
    emergency_flag: form.emergency_flag,
  }), [user.id, form.station_id, form.reg, form.range_km, form.distance_to_next_station_km, form.battery_pct, form.target_pct, form.battery_capacity_kwh, form.emergency_flag]);

  useEffect(() => {
    if (!form.station_id || !form.range_km || !form.distance_to_next_station_km || Number(form.target_pct) <= Number(form.battery_pct)) return undefined;
    const timer = setTimeout(() => api('/bookings/estimate', { method: 'POST', body: JSON.stringify(estimatePayload) })
      .then(setEstimate).catch(() => setEstimate(null)), 300);
    return () => clearTimeout(timer);
  }, [estimatePayload, form.station_id, form.range_km, form.distance_to_next_station_km, form.battery_pct, form.target_pct]);

  useEffect(() => { if (!form.station_id && rankedStations[0]) set('station_id', String(rankedStations[0].id)); }, [form.station_id, rankedStations]);

  const lookupVehicle = async () => {
    const reg = form.reg.trim().toUpperCase();
    if (reg.length < 3) return;
    set('reg', reg);
    try {
      const result = await api(`/vehicles/lookup?reg=${encodeURIComponent(reg)}`);
      setForm(current => ({ ...current, ...result }));
      setLookupState(t('vehicleDetailsLoaded', { reg: result.reg }));
    } catch { setLookupState(t('newVehicleHelp')); }
  };

  const submit = async event => {
    event.preventDefault(); setError(''); setConfirmation(null); setAlternatives([]);
    if (Number(form.target_pct) <= Number(form.battery_pct)) { setError(t('targetMustBeAbove')); return; }
    setSaving(true);
    try {
      const body = { ...form, operator_id: user.id, station_id: Number(form.station_id), battery_capacity_kwh: Number(form.battery_capacity_kwh), range_km: Number(form.range_km), distance_to_next_station_km: Number(form.distance_to_next_station_km), battery_pct: Number(form.battery_pct), target_pct: Number(form.target_pct), preferred_arrival: form.preferred_arrival ? new Date(form.preferred_arrival).toISOString() : null };
      const result = await api('/bookings', { method: 'POST', body: JSON.stringify(body) });
      setConfirmation(result.booking); setAlternatives(result.alternatives || []); await refresh();
      notify(t('bookingPowerConfirmation', { id: result.booking.id, kw: Math.round(result.booking.allocated_kw) }), 'success', t('bookingConfirmed'));
    } catch (submitError) { setError(submitError.message); }
    finally { setSaving(false); }
  };

  return <div className="page-stack">
    <section className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-bullet" /> {t('chargingRequest')}</div><h1>{t('bookCharge')}</h1><p>{t('bookingIntro')}</p></div><div className="heading-side-note"><span className="live-pulse" /> {t('estimateUpdates')}</div></section>
    <div className="booking-layout">
      <form className="panel-card booking-form" onSubmit={submit}>
        <div className="form-section-title"><span>01</span><div><b>{t('vehicleJourney')}</b><small>{t('batteryRouteHelp')}</small></div></div>
        <div className="form-grid">
          <label className="form-field span-two"><span className="field-label">{t('vehicleRegistration')} <i>*</i></span><span className="input-shell registration-shell"><input value={form.reg} onChange={event => { set('reg', event.target.value.toUpperCase()); setLookupState(''); }} onBlur={lookupVehicle} placeholder="e.g. TN38AB1001" required minLength={3} /><span className="lookup-status">{lookupState && <><Check size={13} />{lookupState}</>}</span></span></label>
          <label className="form-field"><span className="field-label">{t('vehicleType')}</span><select className="select-input" value={form.vehicle_type} onChange={event => set('vehicle_type', event.target.value)}><option value="bus">{t('bus')}</option><option value="cab">{t('cab')}</option><option value="hospital vehicle">{t('hospitalVehicle')}</option><option value="private">{t('privateVehicle')}</option></select></label>
          <label className="form-field"><span className="field-label">{t('model')} <i>*</i></span><input className="text-input" value={form.model} onChange={event => set('model', event.target.value)} placeholder={t('vehicleModel')} required minLength={2} /></label>
          <InputField label={t('batteryCapacity')} value={form.battery_capacity_kwh} onChange={value => set('battery_capacity_kwh', value)} min="1" suffix="kWh" />
          <label className="form-field"><span className="field-label">{t('connector')}</span><select className="select-input" value={form.connector_type} onChange={event => set('connector_type', event.target.value)}><option>CCS2</option><option>CHAdeMO</option><option>Type 2</option><option>Bharat DC-001</option></select></label>
          <InputField label={t('remainingRange')} value={form.range_km} onChange={value => set('range_km', value)} min="0.1" suffix="km" help={t('rangeDashboard')} />
          <InputField label={t('nextStationDistance')} value={form.distance_to_next_station_km} onChange={value => set('distance_to_next_station_km', value)} min="0.1" suffix="km" help={t('alongRoute')} />
          <InputField label={t('currentBattery')} value={form.battery_pct} onChange={value => set('battery_pct', value)} min="0" max="100" suffix="%" />
          <InputField label={t('targetBattery')} value={form.target_pct} onChange={value => set('target_pct', value)} min="1" max="100" suffix="%" />
        </div>
        <div className="form-section-title second"><span>02</span><div><b>{t('chooseStation')}</b><small>{t('stationHelp')}</small></div></div>
        <div className="form-grid station-route-grid">
          <label className="form-field"><span className="field-label">{t('busRoute')}</span><select className="select-input" value={form.route_name} onChange={event => set('route_name', event.target.value)}>{ROUTES.map(item => <option key={item.name} value={item.name}>{item.label}</option>)}</select></label>
          <label className="form-field"><span className="field-label">{t('stationSortedRoute')}</span><select className="select-input station-dropdown" value={form.station_id} onChange={event => set('station_id', event.target.value)} required>
            <optgroup label={t('recommendedReachable')}>
              {recommendedStations.map(station => <option key={station.id} value={station.id}>{station.name} · {t('onRouteReachable')} • {station.routeDistance.toFixed(1)} km</option>)}
              {!recommendedStations.length && <option value="" disabled>{t('noReachableStation')}</option>}
            </optgroup>
            <optgroup label={t('allOtherStations')}>
              {otherStations.map(station => <option key={station.id} value={station.id}>{station.name} · {station.onRoute ? `${t('onRouteOutOfRange')} • ${station.routeDistance.toFixed(1)} km` : `${t('offRouteApprox')} ${station.routeDistance.toFixed(1)} km`}</option>)}
            </optgroup>
          </select><small className="field-help">{t('routeDistanceNote')}</small></label>
        </div>
        {selectedRanking && (!selectedRanking.onRoute || !selectedRanking.reachable) && <div className="station-warning"><ShieldAlert size={16} /><span><b>{selectedRanking.onRoute ? t('selectedBeyondRange') : t('selectedOffRoute')}</b> {t('dispatchPlanning')}</span></div>}
        <label className="emergency-toggle"><input type="checkbox" checked={form.emergency_flag} onChange={event => set('emergency_flag', event.target.checked)} /><span><b>{t('emergencyFlag')}</b><small>{t('emergencyHelp')}</small></span></label>
        {stations.some(station => station.is_faulty) && <div className="fault-note"><ShieldAlert size={15} /><span>{t('faultyStationsBlocked')}</span></div>}
        <div className="form-section-title second"><span>03</span><div><b>{t('arrivalPreference')}</b><small>{t('arrivalInformational')}</small></div></div>
        <label className="form-field arrival-field"><span className="field-label">{t('preferredArrival')}</span><span className="input-shell"><input type="datetime-local" value={form.preferred_arrival} onChange={event => set('preferred_arrival', event.target.value)} /><Clock3 size={15} /></span></label>
        {error && <div className="form-error"><ShieldAlert size={16} />{error}</div>}
        <button className="button-primary submit-booking" disabled={saving || !ready}>{saving ? t('creatingBooking') : t('confirmBooking')} <ArrowRight size={16} /></button>
      </form>

      <aside className="estimate-column">
        <section className="estimate-card panel-card"><div className="estimate-top"><span className="estimate-icon"><Sparkles size={17} /></span><div><b>{t('liveEstimate')}</b><small>{t('allocationScore')}</small></div><span className="live-label"><i /> LIVE</span></div>
          {estimate ? <><div className="estimate-number"><b>{Math.round(estimate.allocated_kw)}</b><span>kW</span><span className="estimate-rank">{estimate.status === 'charging' ? t('portAssignment') : t('inQueue')} · #{estimate.rank}</span></div><div className="estimate-details"><div><span>{t('priorityScore')}</span><b>{Number(estimate.score).toFixed(2)} / 1.00</b></div><div><span>{t('estimatedCompletion')}</span><b>{estimate.estimated_completion_minutes ? `${Math.ceil(estimate.estimated_completion_minutes)} min` : t('afterPortOpens')}</b></div><div><span>{t('queueAhead')}</span><b>{Math.max(0, estimate.rank - 1)} {t('buses')}</b></div></div><div className={`priority-explainer ${estimate.is_emergency ? 'urgent' : ''}`}><Zap size={15} /><span>{estimate.explanation}</span></div></> : <div className="estimate-placeholder"><div className="estimate-bars"><i /><i /><i /></div><b>{t('completeVehicleDetails')}</b><span>{t('estimatePlaceholder')}</span></div>}
          <div className="reserve-summary"><div className="reserve-summary-head"><span><ShieldAlert size={14} /> {t('emergencyPool')}</span><b>{selectedStation?.reserve_pct ?? 12}%</b></div><div className="pool-meter"><i style={{ width: `${selectedStation?.reserve_pct ?? 12}%` }} /></div><small>{selectedStation ? `${selectedStation.reserve_pool_kw} kW ${t('protectedAt')} ${selectedStation.name}` : t('reserveProtectedAll')}</small></div>
          {selectedStation?.is_faulty && <div className="form-error"><ShieldAlert size={15} />{selectedStation.fault_message || 'Station is marked faulty.'}</div>}
        </section>

        {confirmation && <section className="confirmation-card panel-card"><div className="confirm-success"><span><Check size={17} /></span><div><b>{t('bookingConfirmed')}</b><small>{t('bus')} {confirmation.reg} {t('joinedLiveQueue')}</small></div></div><div className="confirmation-power"><b>{Math.round(confirmation.allocated_kw)} <small>kW</small></b><span>{t('allocationRank', { rank: confirmation.rank })}</span></div><div className="confirm-meta"><span>{confirmation.station_name}</span><span>{confirmation.estimated_completion_minutes ? `~${Math.ceil(confirmation.estimated_completion_minutes)} min` : t('waitingForPort')}</span></div>
          {/* DEMO ONLY: decorative QR placeholder, not a scannable verification credential. */}
          <div className="qr-placeholder"><div className="qr-art"><QrCode size={55} strokeWidth={2.4} /></div><div><b>{t('qrVerification')}</b><small>{t('qrPlaceholder')}</small></div></div>
          {alternatives.length > 0 && <div className="alternative-box"><b><MapPin size={14} /> {t('nearbyStationFreePort')}</b><p>{alternatives[0].name} · {alternatives[0].distance_km} km · {alternatives[0].ports_free} {t('freePorts')}</p><button onClick={() => set('station_id', String(alternatives[0].id))}>{t('useNextBookingStation')} <ArrowRight size={13} /></button></div>}
        </section>}

        <section className="allocation-note panel-card"><div className="note-icon"><BatteryCharging size={18} /></div><div><b>{t('howAllocationWorks')}</b><p>{t('allocationDescription')}</p></div></section>
      </aside>
    </div>
  </div>;
}
