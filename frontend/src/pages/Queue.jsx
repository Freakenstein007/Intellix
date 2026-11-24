import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, ShieldAlert, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { useAmpwise } from '../App.jsx';

export default function QueuePage() {
  const { stations, loading } = useAmpwise();
  const { t } = useTranslation();
  const [stationId, setStationId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { if (!stationId && stations[0]) setStationId(String(stations.find(item => item.city === 'Chennai')?.id || stations[0].id)); }, [stations]);
  useEffect(() => {
    if (!stationId) return undefined;
    let live = true;
    const load = () => api(`/stations/${stationId}/queue`).then(result => { if (live) { setData(result); setError(''); } }).catch(err => live && setError(err.message));
    load(); const timer = setInterval(load, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [stationId]);
  const station = data?.station;
  const rows = data?.queue || [];
  const chartRows = rows.map(row => ({ reg: row.reg, power: row.allocated_kw, emergency: row.is_emergency }));

  return <div className="page-stack">
    <section className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-bullet" /> {t('dynamicAllocationHeading')}</div><h1>{t('queueHeading')}</h1><p>{t('queueIntro')}</p></div><label className="station-filter"><span>{t('station')}</span><select value={stationId} onChange={event => setStationId(event.target.value)}>{stations.map(item => <option key={item.id} value={item.id}>{item.name} · {item.city}</option>)}</select></label></section>
    {error && <div className="form-error">{error}</div>}
    {station && <><div className="metrics-grid queue-metrics">
      <div className="metric-card"><div className="metric-head"><span>{t('activeQueue')}</span><i className="metric-icon mint"><Activity size={17} /></i></div><div className="metric-value">{station.active_count}<small>{t('vehiclesCount')}</small></div><div className="metric-foot">{station.ports_busy} {t('chargingNow')} · {station.queue_length} {t('waiting')}</div></div>
      <div className="metric-card"><div className="metric-head"><span>{t('stationPower')}</span><i className="metric-icon blue"><Zap size={17} /></i></div><div className="metric-value">{station.allocated_kw}<small>/ {station.total_power_kw} kW</small></div><div className="metric-foot">{station.ports_free} {t('portsAvailable')}</div></div>
      <div className="metric-card"><div className="metric-head"><span>{t('emergencyPool')}</span><i className="metric-icon amber"><ShieldAlert size={17} /></i></div><div className="metric-value">{station.reserve_used_kw}<small>/ {station.reserve_pool_kw} kW</small></div><div className="metric-foot">{t('releasedToNormal', { kw: data.reserve_released_kw })}</div></div>
    </div>
    {station.is_faulty && <div className="alert-banner"><AlertTriangle size={17} /><div><b>{t('chargingFault')}</b><p>{station.fault_message}</p></div></div>}
    <section className="panel-card chart-panel"><div className="panel-titlebar"><div><b>{t('powerByVehicle')}</b><small>{t('weightedPriorityRefresh')}</small></div><span className="chart-legend"><i />{t('normal')} <i className="legend-fault" />{t('emergency')}</span></div>
      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows} margin={{ top: 8, right: 14, bottom: 4, left: -12 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#edf1f5" /><XAxis dataKey="reg" tick={{ fill: '#7c8799', fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis unit=" kW" tick={{ fill: '#9aa4b2', fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={value => [`${value} kW`, 'Allocated power']} contentStyle={{ border: '1px solid #edf0f4', borderRadius: 10, fontSize: 12 }} /><Bar dataKey="power" radius={[6, 6, 0, 0]} maxBarSize={54}>{chartRows.map((row, index) => <Cell key={index} fill={row.emergency ? '#edaa58' : '#48c8a2'} />)}</Bar></BarChart></ResponsiveContainer></div>
    </section>
    <section className="panel-card queue-table-panel"><div className="panel-titlebar"><div><b>{t('livePriorityOrder')}</b><small>{t('emergencySafeThreshold')}</small></div><span className="poll-pill"><i /> 3s {t('updatedLive')}</span></div>
      <div className="queue-table-scroll"><table className="data-table"><thead><tr><th>{t('rank')}</th><th>{t('vehicle')}</th><th>{t('score')}</th><th>{t('batteryNext')}</th><th>{t('power')}</th><th>{t('status')}</th><th>{t('whyAllocation')}</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><span className={`rank-bubble ${row.is_emergency ? 'urgent' : ''}`}>#{row.rank}</span></td><td><b>{row.reg}</b><small>{row.vehicle_type} · {row.model}</small></td><td><b>{Number(row.score || 0).toFixed(2)}</b>{row.is_emergency && <span className="emergency-chip">{t('emergency').toUpperCase()}</span>}</td><td>{Math.round(row.current_battery_pct)}% · {row.range_km} km<br /><small>{row.distance_to_next_station_km} km {t('nextCharger')}</small></td><td><b>{row.allocated_kw} kW</b><small>{row.reserve_allocated_kw ? `${row.reserve_allocated_kw} kW ${t('fromReserve')}` : `${row.borrowed_kw || 0} kW ${t('borrowed')}`}</small></td><td><span className={`status-badge ${row.status}`}>{t(`${row.status}Status`, { defaultValue: row.status })}</span></td><td className="explanation-cell">{row.explanation}</td></tr>)}</tbody></table>{!rows.length && <div className="empty-inline">{t('noBookingsStation')}</div>}</div>
    </section></>}
    {loading && !stations.length && <div className="loading-box">{t('loadingNetwork')}</div>}
  </div>;
}
