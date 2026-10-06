@echo off
cd C:\Users\smsbh\Desktop\quantum\backend
call .venv\Scripts\activate
python -m pytest tests/ -x -v --tb=short 2>&1 > test_output.txt
type test_output.txt