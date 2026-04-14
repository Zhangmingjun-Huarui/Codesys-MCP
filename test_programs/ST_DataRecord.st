TYPE ST_DataRecord :
STRUCT
    nId : DINT;
    rValue : REAL;
    bValid : BOOL;
    sName : STRING(50);
    dtTimestamp : DATE_AND_TIME;
END_STRUCT
END_TYPE
