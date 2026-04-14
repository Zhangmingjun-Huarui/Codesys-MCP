PROGRAM PLC_PRG
VAR
    fbData : FB_PersistentData;
    nStep : INT;
    bTestComplete : BOOL;
    nErrorCount : INT;
    nSuccessCount : INT;
END_VAR
VAR RETAIN
    _retain_CycleCount : DINT;
END_VAR
