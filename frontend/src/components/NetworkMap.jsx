import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';

const markerIcon = (faulty) => L.divIcon({
  className: 'map-marker-wrap',
  html: `<span class="map-marker ${faulty ? 'faulty' : ''}"><i></i></span>`,
  iconSize: [26, 32], iconAnchor: [13, 28], popupAnchor: [0, -28],
});

export default function NetworkMap({ stations = [], activeStation, onSelect }) {
  return <div className="map-frame">
    <MapContainer center={[11.25, 78.1]} zoom={6.4} scrollWheelZoom={false}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {stations.map(station => <Marker key={station.id} position={[station.lat, station.lng]} icon={markerIcon(station.is_faulty)} eventHandlers={{ click: () => onSelect?.(station) }}>
        <Popup><div className="map-popup"><b>{station.name}</b><span>{station.city} · {station.ports_free} ports free</span><small>{station.queue_length} waiting · {station.total_power_kw} kW capacity</small>{station.is_faulty && <em>{station.fault_message || 'Station fault reported'}</em>}</div></Popup>
      </Marker>)}
    </MapContainer>
    <div className="map-legend"><span><i className="legend-good" /> Online</span><span><i className="legend-fault" /> Fault alert</span></div>
    {activeStation && <div className="map-selected"><b>{activeStation.name}</b><span>{activeStation.ports_free} ports free · {activeStation.queue_length} waiting</span></div>}
  </div>;
}
