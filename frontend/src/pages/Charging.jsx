import { useMemo, useState } from 'react';
import { ArrowRight, BatteryCharging, CheckCircle2, Clock3, MapPin, PlugZap, ShieldAlert, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAmpwise } from '../App.jsx';
import { api } from '../api.js';

const money = amount => `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function ChargingPage() {
  const { bookings, alerts, refresh, notify } = useAmpwise();
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const active = useMemo(() => bookings.filter(row => ['charging', 'queued'].includes(row.status)), [bookings]);
  const history = useMemo(() => bookings.filter(row => ['completed', 'cancelled'].includes(row.status)), [bookings]);

  const cancel = async booking => {
    setBusyId(booking.id); setError('');
    try {
      const result = await api(`/bookings/${booking.id}/cancel`, { method: 'POST' });
      notify(t('sessionClosedBillRefund', { bill: money(result.final_bill), refund: money(result.refund) }));
      await refresh();
    } catch (actionError) { setError(actionError.message); }
    finally { setBusyId(null); }
  };

  return <div className="page-stack">
    <section className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-bullet" /> {t('operatorView')}</div><h1>{t('charging')}</h1><p>{t('chargingIntro')}</p></div><span className="poll-pill"><i /> {t('pollingThreeSeconds')}</span></section>
    {alerts.length > 0 && <div className="alert-banner"><ShieldAlert size={17} /><div><b>{t('stationAlert')}</b><p>{alerts.slice(0, 2).map(alert => `${alert.station_name}: ${alert.message}`).join(' · ')}</p></div><small>{alerts.length} {t('notifications')}</small></div>}
    {error && <div className="form-error">{error}</div>}
    <section><div className="section-header compact"><div><div className="section-kicker">{t('activeQueue')}</div><h2>{t('currentSessions')}</h2></div><span className="count-chip">{active.length} {t('active')}</span></div>
      {active.length ? <div className="charging-grid">{active.map(booking => <article className="charging-card panel-card" key={booking.id}>
        <div className="charging-card-top"><div className={`vehicle-monogram large ${booking.is_emergency ? 'emergency' : ''}`}><BatteryCharging size={19} /></div><div className="charging-title"><b>{booking.reg}</b><small>{booking.model} · {booking.vehicle_type}</small></div><span className={`status-badge ${booking.status}`}>{booking.is_emergency && <ShieldAlert size={12} />}{booking.is_emergency ? t('emergencyPriority') : t(`${booking.status}Status`, { defaultValue: booking.status })}</span></div>
        <div className="charging-meta"><span><MapPin size={14} />{booking.station_name}, {booking.city}</span><span><PlugZap size={14} />{booking.connector_type}</span></div>
        <div className="battery-progress-title"><span>{t('batteryProgress')}</span><b>{Math.round(booking.current_battery_pct)}% <i>→</i> {booking.target_pct}%</b></div>
        <div className="progress-track"><i style={{ width: `${Math.max(0, Math.min(100, booking.progress_pct))}%` }} /></div>
        <div className="charging-stats"><div><small>{t('allocatedPower')}</small><b>{Math.round(booking.allocated_kw)} <i>kW</i></b></div><div><small>{t('queuePosition')}</small><b>#{booking.rank || '—'}</b></div><div><small>{t('estimatedCompletion')}</small><b>{booking.estimated_completion_minutes ? `${Math.ceil(booking.estimated_completion_minutes)} min` : t('waiting')}</b></div></div>
        <div className="session-bottom"><span><Clock3 size={13} />{t('started')} {booking.started_at ? new Date(booking.started_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : t('inQueue')}</span><span>{booking.energy_delivered_kwh.toFixed(1)} kWh {t('delivered')}</span></div>
        <button className="button-outline danger-button" disabled={busyId === booking.id} onClick={() => cancel(booking)}>{busyId === booking.id ? t('closing') : t('leaveEarly')} <ArrowRight size={14} /></button>
      </article>)}</div> : <div className="empty-state panel-card"><div className="empty-symbol"><PlugZap size={24} /></div><b>{t('noActiveCharging')}</b><p>{t('liveBookingHelp')}</p></div>}
    </section>

    <section><div className="section-header compact"><div><div className="section-kicker">{t('settledSessions')}</div><h2>{t('recentHistory')}</h2></div></div>
      {history.length ? <div className="panel-card history-table"><div className="history-table-head"><span>{t('vehicleStation')}</span><span>{t('status')}</span><span>{t('energy')}</span><span>{t('finalBill')}</span><span>{t('prepaidRefund')}</span></div>{history.slice(0, 8).map(row => <div className="history-table-row" key={row.id}><div><b>{row.reg}</b><small>{row.station_name}</small></div><span className={`status-badge ${row.status}`}>{t(`${row.status}Status`, { defaultValue: row.status })}</span><b>{row.energy_delivered_kwh.toFixed(1)} kWh</b><b>{money(row.final_bill)}</b><span className="refund-positive">{money(row.refund)} {t('refund')}</span></div>)}</div> : <div className="empty-state panel-card compact-empty"><CheckCircle2 size={22} /><span>{t('settledHelp')}</span></div>}
    </section>
  </div>;
}
