import sys
import os
import traceback
import time

VARIABLE_PATH = "{VARIABLE_PATH}"
VARIABLE_VALUE = "{VARIABLE_VALUE}"

def _convert_value(raw_value):
    if raw_value is None or raw_value == "":
        return raw_value
    v = raw_value.strip()
    if v.lower() in ["true", "yes", "1", "on"]:
        return True
    if v.lower() in ["false", "no", "0", "off"]:
        return False
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    return v

try:
    print("DEBUG: write_variable: Variable='%s', Value='%s', Project='%s'" % (VARIABLE_PATH, VARIABLE_VALUE, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not VARIABLE_PATH:
        raise ValueError("Variable path empty.")

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()

    converted_value = _convert_value(VARIABLE_VALUE)
    print("DEBUG: Converted value: '%s' -> %s (type: %s)" % (VARIABLE_VALUE, converted_value, type(converted_value).__name__))

    write_success = False

    try:
        online_app.set_prepared_value(VARIABLE_PATH, str(converted_value))
        online_app.write_prepared_values()
        print("DEBUG: set_prepared_value + write_prepared_values succeeded.")
        write_success = True
    except Exception as e:
        print("DEBUG: set_prepared_value + write_prepared_values failed: %s" % e)

    if not write_success:
        try:
            online_app.set_prepared_value(VARIABLE_PATH, str(VARIABLE_VALUE))
            online_app.write_prepared_values()
            print("DEBUG: set_prepared_value(string) + write_prepared_values succeeded.")
            write_success = True
        except Exception as e2:
            print("DEBUG: set_prepared_value(string) also failed: %s" % e2)

    if not write_success:
        try:
            online_app.set_prepared_value(VARIABLE_PATH, VARIABLE_VALUE)
            online_app.force_prepared_values()
            print("DEBUG: set_prepared_value + force_prepared_values succeeded.")
            write_success = True
        except Exception as e3:
            print("DEBUG: force_prepared_values also failed: %s" % e3)

    if not write_success:
        raise RuntimeError("All write methods failed for variable '%s'" % VARIABLE_PATH)

    time.sleep(0.3)

    verified_value = None
    try:
        read_result = online_app.read_value(VARIABLE_PATH)
        if read_result is not None:
            verified_value = str(read_result)
            print("DEBUG: Post-write verification read: %s = %s" % (VARIABLE_PATH, verified_value))
    except Exception as verify_err:
        print("DEBUG: Post-write verification failed (non-fatal): %s" % verify_err)

    print("Variable: %s" % VARIABLE_PATH)
    print("Value Written: %s" % VARIABLE_VALUE)
    if verified_value is not None:
        print("Value Verified: %s" % verified_value)
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: Variable written successfully.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error writing variable '%s' in project %s: %s\n%s" % (VARIABLE_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
