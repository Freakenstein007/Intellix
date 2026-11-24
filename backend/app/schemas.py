from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LoginRequest(BaseModel):
    role: Literal["operator", "admin"]
    user_id: int | None = None


class VehicleInput(BaseModel):
    reg: str = Field(min_length=3, max_length=24)
    vehicle_type: Literal["bus", "cab", "hospital vehicle", "private"] = "bus"
    model: str = Field(min_length=2, max_length=80)
    battery_capacity_kwh: float = Field(gt=0, le=2000)
    connector_type: str = Field(min_length=2, max_length=32)
    operator_id: int

    @field_validator("reg")
    @classmethod
    def uppercase_reg(cls, value: str) -> str:
        return value.strip().upper()


class BookingInput(BaseModel):
    operator_id: int
    station_id: int
    reg: str = Field(min_length=3, max_length=24)
    vehicle_type: Literal["bus", "cab", "hospital vehicle", "private"] = "bus"
    model: str = Field(min_length=2, max_length=80)
    battery_capacity_kwh: float = Field(gt=0, le=2000)
    connector_type: str = "CCS2"
    range_km: float = Field(gt=0, le=2000)
    distance_to_next_station_km: float = Field(gt=0, le=2000)
    battery_pct: float = Field(ge=0, le=100)
    target_pct: float = Field(gt=0, le=100)
    emergency_flag: bool = False
    preferred_arrival: datetime | None = None

    @field_validator("reg")
    @classmethod
    def uppercase_reg(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def target_must_exceed_current(self):
        if self.target_pct <= self.battery_pct:
            raise ValueError("Target battery must be above the current battery level.")
        return self


class EstimateInput(BaseModel):
    operator_id: int
    station_id: int
    reg: str = "DEMO"
    range_km: float = Field(gt=0)
    distance_to_next_station_km: float = Field(gt=0)
    battery_pct: float = Field(ge=0, le=100)
    target_pct: float = Field(gt=0, le=100)
    battery_capacity_kwh: float = Field(gt=0)
    emergency_flag: bool = False

    @model_validator(mode="after")
    def target_must_exceed_current(self):
        if self.target_pct <= self.battery_pct:
            raise ValueError("Target battery must be above the current battery level.")
        return self


class StationSettings(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    city: str = Field(min_length=2, max_length=80)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    num_ports: int = Field(ge=1, le=100)
    total_power_kw: float = Field(gt=0, le=100000)
    reserve_pct: float = Field(ge=10, le=15)
    max_charger_kw: float = Field(gt=0, le=10000)
    floor_pct: float = Field(gt=0, le=100)
    tariff: float = Field(ge=0, le=100000)
    w1: float = Field(ge=0, le=1)
    w2: float = Field(ge=0, le=1)


class FaultInput(BaseModel):
    message: str = Field(min_length=4, max_length=500)


class RatingInput(BaseModel):
    booking_id: int
    operator_id: int
    stars: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=1000)
