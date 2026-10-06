@echo off
cd C:\Users\smsbh\Desktop\quantum\backend
call .venv\Scripts\activate
python -m uvicorn app.main:app --port 8000 --host 127.0.0.1