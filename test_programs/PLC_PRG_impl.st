_retain_CycleCount := _retain_CycleCount + 1;

fbData();

CASE nStep OF
0:
    nErrorCount := 0;
    nSuccessCount := 0;
    nStep := 10;

10:
    IF fbData._nCounter >= 0 AND NOT fbData._bLastError THEN
        nSuccessCount := nSuccessCount + 1;
    ELSE
        nErrorCount := nErrorCount + 1;
    END_IF;
    nStep := 20;

20:
    bTestComplete := TRUE;
    IF nErrorCount = 0 THEN
        nStep := 30;
    ELSE
        nStep := 30;
    END_IF;

30:
    ;
END_CASE
