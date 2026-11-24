import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BatteryCharging, BusFront, MapPin, ShieldAlert, Zap } from 'lucide-react';
import NetworkMap from '../components/NetworkMap.jsx';
import { useAmpwise } from '../App.jsx';

const fmt = value => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value || 0);
const clock = value => value ? new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—';

function Metric({ label, value, suffix, note, icon: Icon, tone, trend }) {
  return <article className="metric-card"><div className="metric-head"><span>{label}</span><i className={`metric-icon ${tone}`}><Icon size={17} /></i></div><div className="metric-value">{value}<small>{suffix}</small></div><div className="metric-foot"><span className={`metric-trend ${trend === 'down' ? 'down' : ''}`}>{trend === 'down' ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}{note}</span></div></article>;
}

export default function Dashboard() {
  const { stations, bookings, loading, user } = useAmpwise();
  const { t } = useTranslation();
  const statusText = (status, urgent) => urgent ? t('emergency') : t(`${status}Status`, { defaultValue: status });
  const [selectedStation, setSelectedStation] = useState(null);
  const active = bookings.filter(booking => ['charging', 'queued'].includes(booking.status));
  const charging = bookings.filter(booking => booking.status === 'charging');
  const powerUsed = stations.reduce((sum, station) => sum + (station.allocated_kw || 0), 0);
  const reserveUsed = stations.reduce((sum, station) => sum + (station.reserve_used_kw || 0), 0);
  const totalPower = stations.reduce((sum, station) => sum + station.total_power_kw, 0);
  const recent = useMemo(() => [...active].sort((a, b) => (b.is_emergency - a.is_emergency) || ((b.score || 0) - (a.score || 0))).slice(0, 5), [bookings]);

  return <div className="page-stack">
    <section className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-bullet" /> {t('networkOperations')}</div><h1>{t('welcome')}, {user.name.split(' ')[0]} <span className="hello-star">✳</span></h1><p>{t('overviewIntro')}</p></div><Link className="button-primary" to="/book"><span>＋</span> {t('bookNow')}</Link></section>
    <div className="metrics-grid">
      <Metric label={t('active')} value={active.length} suffix={t('buses')} note={`${charging.length} ${t('chargingNow')}`} icon={BusFront} tone="mint" />
      <Metric label={t('power')} value={fmt(powerUsed)} suffix="kW" note={`${Math.round(powerUsed / Math.max(1, totalPower) * 100)}% ${t('networkLoad')}`} icon={Zap} tone="blue" />
      <Metric label={t('stations')} value={`${stations.filter(station => !station.is_faulty).length}/${stations.length}`} suffix={t('online')} note={`${stations.filter(station => station.ports_free > 0).length} ${t('withFreePorts')}`} icon={MapPin} tone="violet" />
      <Metric label={t('reserve')} value={fmt(reserveUsed)} suffix="kW used" note={`12% ${t('protectedPerStation')}`} icon={ShieldAlert} tone="amber" trend="down" />
    </div>

    <section className="section-header"><div><div className="section-kicker">{t('tamilNaduNetwork')}</div><h2>{t('chargingStations')}</h2><p>{t('capacityAvailability')}</p></div><Link to="/queue" className="link-button">{t('viewNetworkQueue')} <ArrowRight size={15} /></Link></section>
    <section className="network-layout">
      <div className="map-panel panel-card"><div className="panel-titlebar"><div><b>{t('stationMap')}</b><small>{stations.length} {t('hubsTamilNadu')}</small></div><span className="map-status"><i /> LIVE MAP</span></div><NetworkMap stations={stations} activeStation={selectedStation} onSelect={setSelectedStation} /></div>
      <div className="station-list-panel panel-card"><div className="panel-titlebar"><div><b>{t('stationStatus')}</b><small>{stations.length} {t('chargingLocations')}</small></div><Link to="/admin" title={t('stationSettings')}><ArrowRight size={15} /></Link></div>
        <div className="station-list">{loading && !stations.length ? <div className="loading-box">{t('loadingStations')}</div> : stations.map(station => <button key={station.id} className={`station-list-row ${selectedStation?.id === station.id ? 'active' : ''}`} onClick={() => setSelectedStation(station)}>
          <span className={`station-mini-icon ${station.is_faulty ? 'faulty' : ''}`}><MapPin size={16} /></span><span className="station-row-copy"><b>{station.name}</b><small>{station.city} · {station.ports_free} / {station.num_ports} {t('freePorts')}</small></span><span className="station-row-side"><b>{fmt(station.allocated_kw)} <small>kW</small></b><span className={station.is_faulty ? 'status-text faulty-text' : 'status-text'}><i />{station.is_faulty ? t('fault') : t('waitingCount', { count: station.queue_length })}</span></span>
        </button>)}</div>
      </div>
    </section>

    <section className="section-header lower-heading"><div><div className="section-kicker">{t('priorityInAction')}</div><h2>{t('liveQueue')}</h2><p>{t('lowRangeFirst')}</p></div><Link to="/queue" className="link-button">{t('openStationQueue')} <ArrowRight size={15} /></Link></section>
    <section className="panel-card queue-preview"><div className="queue-preview-head"><span>{t('vehicleOperator')}</span><span>{t('stationStatus')}</span><span>{t('battery')}</span><span>{t('power')}</span><span>{t('status')}</span><span>{t('eta')}</span></div>
      {recent.length ? recent.map(booking => <div className="queue-preview-row" key={booking.id}><div className="vehicle-identity"><span className={`vehicle-monogram ${booking.is_emergency ? 'emergency' : ''}`}><BusFront size={16} /></span><span><b>{booking.reg}</b><small>{booking.vehicle_type} · #{booking.id}</small></span></div><span>{booking.station_name}</span><div className="battery-cell"><div className="battery-mini"><i style={{ width: `${Math.max(3, booking.current_battery_pct)}%` }} /></div><b>{Math.round(booking.current_battery_pct)}%</b></div><b className="power-cell">{fmt(booking.allocated_kw)} <small>kW</small></b><span className={`status-badge ${booking.status}`}>{booking.is_emergency && <ShieldAlert size={12} />}{statusText(booking.status, booking.is_emergency)}</span><span className="eta-cell">{booking.estimated_completion_minutes ? `${Math.ceil(booking.estimated_completion_minutes)} min` : t('inQueue')}</span></div>) : <div className="empty-inline">{t('noActiveBookings')} <Link to="/book">{t('bookVehicle')}</Link></div>}
      <div className="queue-preview-footer"><span><Activity size={14} /> {t('queueRefresh')}</span><Link to="/charging">{t('myChargingSessions')} <ArrowRight size={14} /></Link></div>
    </section>
    <div className="dashboard-note"><BatteryCharging size={15} /><span>{t('allocationBasis')}</span><span>{fmt(totalPower)} kW</span></div>
  </div>;
}
