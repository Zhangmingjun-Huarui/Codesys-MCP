FUNCTION_BLOCK FB_PersistentData
VAR
    _nCounter : DINT;
    _rTemperature : REAL;
    _bAlarmActive : BOOL;
    _nWriteCount : DINT;
    _nReadCount : DINT;
    _bLastError : BOOL;
END_VAR
VAR RETAIN
    _retain_Counter : DINT;
    _retain_Temperature : REAL;
    _retain_AlarmActive : BOOL;
    _retain_Initialized : BOOL;
END_VAR
