from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="operator")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="operator")


class Station(Base):
    __tablename__ = "stations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    num_ports: Mapped[int] = mapped_column(Integer, nullable=False)
    total_power_kw: Mapped[float] = mapped_column(Float, nullable=False)
    reserve_pct: Mapped[float] = mapped_column(Float, nullable=False, default=12)
    max_charger_kw: Mapped[float] = mapped_column(Float, nullable=False)
    floor_pct: Mapped[float] = mapped_column(Float, nullable=False, default=20)
    tariff: Mapped[float] = mapped_column(Float, nullable=False, default=18)
    w1: Mapped[float] = mapped_column(Float, nullable=False, default=0.6)
    w2: Mapped[float] = mapped_column(Float, nullable=False, default=0.4)
    is_faulty: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fault_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    bookings: Mapped[list["Booking"]] = relationship(back_populates="station")


class Vehicle(Base):
    __tablename__ = "vehicles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reg: Mapped[str] = mapped_column(String(24), unique=True, index=True, nullable=False)
    vehicle_type: Mapped[str] = mapped_column(String(24), nullable=False, default="bus")
    model: Mapped[str] = mapped_column(String(80), nullable=False)
    battery_capacity_kwh: Mapped[float] = mapped_column(Float, nullable=False)
    connector_type: Mapped[str] = mapped_column(String(32), nullable=False, default="CCS2")
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)


class Booking(Base):
    __tablename__ = "bookings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), nullable=False)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), nullable=False, index=True)
    range_km: Mapped[float] = mapped_column(Float, nullable=False)
    distance_to_next_station_km: Mapped[float] = mapped_column(Float, nullable=False)
    battery_pct: Mapped[float] = mapped_column(Float, nullable=False)
    current_battery_pct: Mapped[float] = mapped_column(Float, nullable=False)
    target_pct: Mapped[float] = mapped_column(Float, nullable=False)
    emergency_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    preferred_arrival: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    energy_delivered_kwh: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    prepaid_estimate: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    final_bill: Mapped[float | None] = mapped_column(Float, nullable=True)
    refund: Mapped[float | None] = mapped_column(Float, nullable=True)
    amount_due: Mapped[float | None] = mapped_column(Float, nullable=True)
    operator: Mapped[User] = relationship(back_populates="bookings")
    vehicle: Mapped[Vehicle] = relationship()
    station: Mapped[Station] = relationship(back_populates="bookings")
    allocation: Mapped["Allocation | None"] = relationship(back_populates="booking", uselist=False, cascade="all, delete-orphan")


class Allocation(Base):
    __tablename__ = "allocations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), unique=True, nullable=False)
    allocated_kw: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    reserve_allocated_kw: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    borrowed_kw: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_emergency: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    safe_target_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    booking: Mapped[Booking] = relationship(back_populates="allocation")


class Rating(Base):
    __tablename__ = "ratings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id"), nullable=False)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), nullable=False)
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    stars: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("booking_id", "operator_id", name="uq_rating_booking_operator"),)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), nullable=False)
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    station: Mapped[Station] = relationship()
