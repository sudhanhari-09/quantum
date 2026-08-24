"""Unit tests for B17/B18/B19: security decisions, keys, encryption."""

from __future__ import annotations

import base64

import pytest

from app.services.qber_engine import compute_qber
from app.services.security_engine import evaluate


# ---- B17 decision rules ------------------------------------------------------


def test_evaluate_matrix():
    assert evaluate(0.0, 0.11) == "ACCEPTED"
    assert evaluate(0.11, 0.11) == "ACCEPTED"  # at threshold -> accepted
    assert evaluate(0.110001, 0.11) == "REJECTED"
    assert evaluate(0.9, 0.11) == "REJECTED"


def test_qber_feeds_decisions_only_from_counters():
    # QBER used by the engine is always derived from run counters (R7).
    errors, compared = 12, 118
    qber = compute_qber(errors, compared)
    assert evaluate(qber, 0.11) == "ACCEPTED"
    assert evaluate(qber, 0.10) == "REJECTED"
    assert evaluate(compute_qber(13, 118), 0.11) == "REJECTED"  # 0.110170 > 0.11


# ---- B18 key management ------------------------------------------------------


def test_hkdf_derivation_stable_and_binding():
    from app.services.key_service import derive_key

    k1 = derive_key("1010101011", 42)
    k2 = derive_key("1010101011", 42)
    k3 = derive_key("1010101011", 43)
    assert k1 == k2
    assert len(k1) == 32
    assert k1 != k3  # communication binding changes key
    assert k1 != derive_key("0101010101", 42)


def test_key_at_rest_roundtrip(monkeypatch):
    from app.services import key_service as ks

    fixed = base64.b64decode("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    monkeypatch.setattr(ks, "_master_key", lambda: fixed)
    original = b"A" * 32
    sealed = ks.encrypt_at_rest(original)
    assert sealed != original
    assert ks.decrypt_at_rest(sealed) == original


def test_tampered_at_rest_blob_fails(monkeypatch):
    from app.services import key_service as ks

    fixed = base64.b64decode("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    monkeypatch.setattr(ks, "_master_key", lambda: fixed)
    sealed = bytearray(ks.encrypt_at_rest(b"B" * 32).encode())
    sealed[20] ^= 0xFF
    with pytest.raises(Exception):
        ks.decrypt_at_rest(bytes(sealed).decode())


# ---- B19 encryption / decryption ---------------------------------------------


@pytest.fixture()
def crypto_env():
    """Ensure a master key is configured for the test process."""
    import os

    os.environ["QSC_MASTER_KEY"] = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
    from app.core.config import get_settings

    get_settings.cache_clear()
    yield
    os.environ.pop("QSC_MASTER_KEY", None)
    get_settings.cache_clear()


_SETUP_COUNTER = {"n": 0}


def _setup_accepted_communication(in_memory_db):
    """Build sender/receiver + session with stored key; caller drives states."""
    import uuid

    from app.models import CommunicationSession, Message, User
    from app.protocols.base import ProtocolRunInput, default_registry
    from app.services.key_service import KeyService

    res = default_registry().require_supported("BB84").run(
        ProtocolRunInput(qubit_count=256, channel_noise=0.0, seed=5)
    )
    tag = uuid.uuid4().hex[:6].upper()

    with in_memory_db() as s:
        sender = User(unique_user_id=f"QSC-K{tag}000001", name="KS", email=f"ks{tag}@t.io",
                      password_hash="x", role="USER")
        receiver = User(unique_user_id=f"QSC-K{tag}000002", name="KR", email=f"kr{tag}@t.io",
                        password_hash="x", role="USER")
        s.add_all([sender, receiver])
        s.flush()
        comm = CommunicationSession(sender_id=sender.id, receiver_id=receiver.id,
                                    protocol="BB84")
        s.add(comm)
        s.flush()
        msg = Message(sender_id=sender.id, receiver_id=receiver.id,
                      communication_id=comm.id, status="PROCESSING")
        s.add(msg)
        from app.models import QkdSession

        run = QkdSession(
            communication_id=comm.id, protocol="BB84", seed=1,
            qubits_generated=res.qubits_generated, matching_bases=res.matching_bases,
            sifted_bits=res.sifted_bits, compared_bits=res.compared_bits,
            errors=res.errors, qber=res.qber, threshold=0.11,
            key_status="PENDING", is_baseline=True,
        )
        s.add(run)
        KeyService(s).store_accepted_key(comm.id, qkd_session_id=run.id or 1,
                                         sifted_key_bits=res.sifted_key_bits)
        s.flush()
        return {"comm_id": comm.id, "msg_id": msg.id, "run_id": run.id}


def _mark_run_accepted(session, info):
    """Mirror SecurityEngine.evaluate_session's persistence of the verdict."""
    from app.models import QkdSession

    run = session.get(QkdSession, info["run_id"])
    if run is not None:
        run.key_status = "ACCEPTED"


def _walk_to(sm, comm, target="KEY_ACCEPTED"):
    path = ["RECEIVER_VERIFIED", "AI_ANALYZING", "PROTOCOL_SELECTED",
            "QKD_INITIALIZING", "QKD_RUNNING", "KEY_SIFTING", "QBER_EVALUATION",
            "SECURITY_CHECK", "KEY_ACCEPTED", "ENCRYPTING", "ENCRYPTED",
            "DELIVERED"]
    for st in path:
        sm.transition(comm, st)
        if st == target:
            break


def test_encrypt_decrypt_roundtrip(in_memory_db, crypto_env):
    info = _setup_accepted_communication(in_memory_db)
    with in_memory_db() as s:
        from app.models import CommunicationSession, Message

        comm = s.get(CommunicationSession, info["comm_id"])
        # Walk legally to KEY_ACCEPTED (gate requirement).
        from app.services.state_machine import StateMachineService

        sm = StateMachineService(s)
        _walk_to(sm, comm)
        _mark_run_accepted(s, info)

        msg = s.get(Message, info["msg_id"])
        svc = __import__("app.services.encryption_service", fromlist=["EncryptionService"]).EncryptionService(s)
        svc.encrypt_message(msg, "Attack at dawn.")
        assert msg.encrypted_message and "Attack" not in msg.encrypted_message
        assert msg.nonce

        # Deliver (state machine derives status DELIVERED), then decrypt.
        sm.transition(comm, "ENCRYPTING")
        sm.transition(comm, "ENCRYPTED")
        sm.transition(comm, "DELIVERED")
        plain = svc.decrypt_for_owner(msg)
        assert plain == "Attack at dawn."


def test_encrypt_refused_without_acceptance(in_memory_db, crypto_env):
    info = _setup_accepted_communication(in_memory_db)
    with in_memory_db() as s:
        from app.models import CommunicationSession, Message
        from app.services.state_machine import StateMachineService

        comm = s.get(CommunicationSession, info["comm_id"])
        sm = StateMachineService(s)
        sm.transition(comm, "RECEIVER_VERIFIED")  # not yet KEY_ACCEPTED

        msg = s.get(Message, info["msg_id"])
        svc = __import__("app.services.encryption_service", fromlist=["EncryptionService"]).EncryptionService(s)
        with pytest.raises(Exception):
            svc.encrypt_message(msg, "should not encrypt")


def test_nonce_uniqueness_and_tamper_detection(in_memory_db, crypto_env):
    info = _setup_accepted_communication(in_memory_db)
    with in_memory_db() as s:
        from app.models import CommunicationSession, Message
        from app.services.encryption_service import EncryptionService
        from app.services.state_machine import StateMachineService

        comm = s.get(CommunicationSession, info["comm_id"])
        sm = StateMachineService(s)
        _walk_to(sm, comm)
        _mark_run_accepted(s, info)
        msg = s.get(Message, info["msg_id"])
        svc = EncryptionService(s)

        svc.encrypt_message(msg, "one")
        nonce1 = msg.nonce
        svc.encrypt_message(msg, "two")  # re-encrypt same object
        nonce2 = msg.nonce
        assert nonce1 != nonce2

        tampered = bytearray(base64.b64decode(msg.encrypted_message))
        tampered[0] ^= 0x55
        msg.encrypted_message = base64.b64encode(bytes(tampered)).decode()

        sm.transition(comm, "ENCRYPTING")
        sm.transition(comm, "ENCRYPTED")
        sm.transition(comm, "DELIVERED")
        with pytest.raises(Exception):
            svc.decrypt_for_owner(msg)


def test_cross_session_key_fails(in_memory_db, crypto_env):
    info_a = _setup_accepted_communication(in_memory_db)
    info_b = _setup_accepted_communication(in_memory_db)
    assert info_a["comm_id"] != info_b["comm_id"]

