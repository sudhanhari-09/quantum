"""Message schemas (Section 19)."""

from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

QSC_RE = re.compile(r"^QSC-[A-Z0-9]{10}$")


class CreateMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    receiver_qsc_id: str = Field(min_length=1, max_length=20)
    content: str = Field(min_length=1, max_length=2000)
    security_requirement: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"

    @field_validator("receiver_qsc_id")
    @classmethod
    def valid_qsc(cls, v: str) -> str:
        if not QSC_RE.match(v.strip().upper()):
            raise ValueError("QSC ID must match QSC-[A-Z0-9]{10}")
        return v.strip().upper()


class MessageCreatedResponse(BaseModel):
    message_id: int
    communication_id: int
    status: str
    message: str


class MessageListUser(BaseModel):
    id: int
    name: str


class MessageListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sender: Optional[MessageListUser] = None
    protocol: Optional[str] = None
    qber: Optional[float] = None
    key_status: Optional[str] = None
    status: str
    attack_detected: bool
    created_at: str
    read_at: Optional[str] = None


class PaginatedMessages(BaseModel):
    items: list[dict]
    total: int
    page: int
    limit: int


class MessageDetailResponse(BaseModel):
    id: int
    sender: MessageListUser
    receiver: MessageListUser
    content: Optional[str] = None
    protocol: Optional[str]
    qber: Optional[float]
    key_status: Optional[str]
    status: str
    attack_detected: bool
    created_at: str
    read_at: Optional[str]


class SecurityReportResponse(BaseModel):
    report: dict


class CommunicationDetail(BaseModel):
    id: int
    sender: dict
    receiver: dict
    protocol: Optional[str]
    session_status: str
    message_status: str
    key_status: str
    qber: Optional[float]
    attack_detected: bool
    created_at: str
    completed_at: Optional[str]


class RecommendationResponse(BaseModel):
    protocol: str
    confidence: float
    explanation: str
    scores: dict
    features: dict
    evaluated_at: str


class AttackCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Validated in the service layer so unknown types yield the contract
    # code INVALID_ATTACK_TYPE (422) rather than a generic schema error.
    attack_type: str = Field(min_length=1, max_length=32)
    attack_strength: float = Field(ge=0.1, le=1.0)
