import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Check, Gauge, Settings2, ShieldAlert, Users, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { useAmpwise } from '../App.jsx';

const settingsFrom = station => ({ name: station.name, city: station.city, lat: station.lat, lng: station.lng, num_ports: station.num_ports, total_power_kw: station.total_power_kw, reserve_pct: station.reserve_pct, max_charger_kw: station.max_charger_kw, floor_pct: station.floor_pct, tariff: station.tariff, w1: station.w1, w2: station.w2 });

export default function AdminPage() {
  const { user, stations, refresh, notify } = useAmpwise();
  const { t } = useTranslation();
  const [stationId, setStationId] = useState('');
  const station = stations.find(row => row.id === Number(stationId)) || stations[0];
  const [form, setForm] = useState(null);
  const [fleet, setFleet] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!stationId && stations[0]) setStationId(String(stations.find(row => row.city === 'Chennai')?.id || stations[0].id)); }, [stations]);
  useEffect(() => { if (station) setForm(settingsFrom(station)); }, [station?.id]);
  useEffect(() => {
    if (user.role !== 'admin') return undefined;
    let live = true;
    const load = async () => {
      try { const [vehicles, compare] = await Promise.all([api('/demo/fleet'), station ? api(`/stations/${station.id}/compare`) : Promise.resolve(null)]); if (live) { setFleet(vehicles); setComparison(compare); } }
      catch (err) { if (live) setError(err.message); }
    };
    load(); const timer = setInterval(load, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [user.role, station?.id]);

  if (user.role !== 'admin') return <div className="page-stack"><section className="page-heading-row"><div><div className="eyebrow">{t('adminAccess')}</div><h1>{t('admin')}</h1><p>{t('adminControlsAvailable')}</p></div></section><div className="empty-state panel-card"><div className="empty-symbol"><Settings2 size={24} /></div><b>{t('switchAdmin')}</b><p>{t('seededDemoAccount')}</p></div></div>;

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async event => {
    event.preventDefault(); if (!station || !form) return;
    setBusy(true); setError('');
    try { await api(`/stations/${station.id}`, { method: 'PUT', body: JSON.stringify({ ...form, num_ports: Number(form.num_ports), lat: Number(form.lat), lng: Number(form.lng), total_power_kw: Number(form.total_power_kw), reserve_pct: Number(form.reserve_pct), max_charger_kw: Number(form.max_charger_kw), floor_pct: Number(form.floor_pct), tariff: Number(form.tariff), w1: Number(form.w1), w2: Number(form.w2) }) }); await refresh(); notify(`${station.name} settings updated and queue reallocated.`); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const toggleFault = async () => {
    if (!station) return;
    setBusy(true); setError('');
    try {
      if (station.is_faulty) await api(`/stations/${station.id}/clear-fault`, { method: 'POST' });
      else await api(`/stations/${station.id}/fault`, { method: 'POST', body: JSON.stringify({ message: `${station.name} charger inspection in progress. New bookings are paused.` }) });
      await refresh(); notify(station.is_faulty ? 'Station fault cleared.' : 'Fault alert sent to operators.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const demoAction = async action => {
    if (!station) return;
    setBusy(true); setError('');
    try {
      if (action === 'emergency') await api(`/demo/emergency-bus?station_id=${station.id}`, { method: 'POST' });
      if (action === 'capacity') await api(`/demo/reduce-capacity?station_id=${station.id}`, { method: 'POST' });
      if (action === 'reset') await api('/demo/reset', { method: 'POST' });
      await refresh(); notify(`Demo ${action === 'emergency' ? 'emergency bus added' : action === 'capacity' ? 'capacity reduced' : 'network reset'}.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return <div className="page-stack">
    <section className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-bullet" /> {t('networkAdministration')}</div><h1>{t('admin')}</h1><p>{t('adminIntro')}</p></div><span className="role-admin-badge"><ShieldAlert size={14} /> {t('adminDemo')}</span></section>
    {error && <div className="form-error">{error}</div>}
    <section className="admin-control-grid"><form className="panel-card admin-settings" onSubmit={save}><div className="panel-titlebar"><div><b>{t('stationSettings')}</b><small>{t('editsReallocate')}</small></div><Settings2 size={18} color="#7d8ca2" /></div>
      <label className="form-field station-select-admin"><span className="field-label">{t('selectedStation')}</span><select className="select-input" value={station?.id || ''} onChange={event => setStationId(event.target.value)}>{stations.map(row => <option key={row.id} value={row.id}>{row.name} · {row.city}</option>)}</select></label>
      {form && <div className="settings-form-grid">{[
        ['name','stationName','text'], ['city','city','text'], ['num_ports','numberPorts','number'], ['total_power_kw','totalPowerLimit','number'], ['reserve_pct','emergencyReservePercent','number'], ['max_charger_kw','maxChargerRate','number'], ['floor_pct','powerFloor','number'], ['tariff','tariff','number'], ['w1','rangeWeight','number'], ['w2','distanceWeight','number'], ['lat','latitude','number'], ['lng','longitude','number'],
      ].map(([key, label, type]) => <label className="form-field" key={key}><span className="field-label">{t(label)}</span><input className="text-input" type={type} step={type === 'number' ? 'any' : undefined} min={type === 'number' && key !== 'lat' && key !== 'lng' ? 0 : undefined} value={form[key]} onChange={event => update(key, event.target.value)} required /></label>)}</div>}
      <div className="admin-actions"><button className="button-primary" disabled={busy}><Check size={15} /> {t('saveReallocate')}</button><button type="button" className={`button-outline ${station?.is_faulty ? 'clear-fault-button' : 'danger-button'}`} onClick={toggleFault} disabled={busy}>{station?.is_faulty ? t('clearStationFault') : t('markStationFaulty')}</button></div>
    </form>
    <div className="admin-side-stack"><section className="panel-card comparison-panel"><div className="panel-titlebar"><div><b>{t('allocatorComparison')}</b><small>{t('lowerDelayBetter')}</small></div><Gauge size={18} color="#568bd9" /></div><div className="comparison-grid"><div className="comparison-head"><span>{t('metric')}</span><b>AMPWISE</b><b>{t('fcfsBaseline')}</b></div>{[
      [t('busesCharging'), comparison?.ampwise?.buses_ready, comparison?.fcfs?.buses_ready],
      [t('peakPowerLoad'), `${comparison?.ampwise?.peak_load_kw ?? '—'} kW`, `${comparison?.fcfs?.peak_load_kw ?? '—'} kW`],
      [t('nonEmergencyDelay'), `${comparison?.ampwise?.avg_non_emergency_delay_minutes ?? '—'} min`, `${comparison?.fcfs?.avg_non_emergency_delay_minutes ?? '—'} min`],
      [t('waitingBuses'), comparison?.ampwise?.buses_waiting, comparison?.fcfs?.buses_waiting],
    ].map(row => <div className="comparison-row" key={row[0]}><span>{row[0]}</span><b>{row[1] ?? '—'}</b><b>{row[2] ?? '—'}</b></div>)}</div></section>
    <section className="panel-card demo-controls"><div className="panel-titlebar"><div><b>{t('demoControls')}</b><small>{t('showReallocation')}</small></div><span className="demo-tag">DEMO</span></div><button onClick={() => demoAction('emergency')} disabled={busy}><span className="demo-action-icon amber"><AlertTriangle size={15} /></span><span><b>{t('addEmergencyBus')}</b><small>{t('injectEmergency')}</small></span><ArrowRightSmall /></button><button onClick={() => demoAction('capacity')} disabled={busy}><span className="demo-action-icon blue"><Zap size={15} /></span><span><b>{t('reduceCapacity')}</b><small>{t('supplyReduction')}</small></span><ArrowRightSmall /></button><button onClick={() => demoAction('reset')} disabled={busy}><span className="demo-action-icon mint"><Activity size={15} /></span><span><b>{t('resetDemo')}</b><small>{t('recreateDemo')}</small></span><ArrowRightSmall /></button></section></div></section>
    <section className="panel-card fleet-panel"><div className="panel-titlebar"><div><b><Users size={16} /> {t('fleetRegister')}</b><small>{t('vehicleAvailability')}</small></div><span className="count-chip">{fleet.length} {t('vehicles')}</span></div><div className="queue-table-scroll"><table className="data-table"><thead><tr><th>{t('registration')}</th><th>{t('typeModel')}</th><th>{t('battery')}</th><th>{t('connector')}</th><th>{t('range')}</th><th>{t('availability')}</th><th>{t('nextDeparture')}</th></tr></thead><tbody>{fleet.map(row => <tr key={row.id}><td><b>{row.reg}</b></td><td>{row.vehicle_type}<small>{row.model}</small></td><td>{row.battery_capacity_kwh} kWh</td><td>{row.connector_type}</td><td>{row.range_km ? `${row.range_km} km` : '—'}</td><td><span className={`status-badge ${row.availability === 'Available' ? 'completed' : 'charging'}`}>{row.availability === 'Available' ? t('available') : t('booked')}</span></td><td>{row.next_departure ? new Date(row.next_departure).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—'}</td></tr>)}</tbody></table>{!fleet.length && <div className="empty-inline">{t('loadingFleet')}</div>}</div></section>
  </div>;
}

function ArrowRightSmall() { return <span className="action-arrow">→</span>; }
