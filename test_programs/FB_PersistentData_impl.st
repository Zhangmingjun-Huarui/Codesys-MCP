IF NOT _retain_Initialized THEN
    _retain_Counter := 0;
    _retain_Temperature := 20.0;
    _retain_AlarmActive := FALSE;
    _retain_Initialized := TRUE;
    _nWriteCount := 0;
    _nReadCount := 0;
    _bLastError := FALSE;
END_IF

_nCounter := _retain_Counter;
_rTemperature := _retain_Temperature;
_bAlarmActive := _retain_AlarmActive;
_nReadCount := _nReadCount + 1;

IF _nCounter > 1000000 THEN
    _bLastError := TRUE;
ELSE
    _bLastError := FALSE;
END_IF

IF _rTemperature < -273.15 THEN
    _bLastError := TRUE;
END_IF
