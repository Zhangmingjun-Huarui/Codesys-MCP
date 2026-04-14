import sys
import traceback
import time

PROJECT_FILE_PATH = r"{PROJECT_FILE_PATH}"

def _log(msg):
    print(msg)
    sys.stdout.flush()

try:
    _log("DEBUG: connect_to_device via IPC starting...")
    _log("DEBUG: Project: %s" % PROJECT_FILE_PATH)

    proj = projects.primary
    if proj is None:
        raise RuntimeError("No project is open. Open project first.")

    target_app = None
    try:
        target_app = proj.active_application
    except:
        pass

    if not target_app:
        try:
            children = proj.get_children(True)
            for child in children:
                if hasattr(child, 'is_application') and child.is_application:
                    target_app = child
                    break
        except:
            pass

    if not target_app:
        raise RuntimeError("No application found in project.")

    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    _log("DEBUG: Application: %s" % app_name)

    online_app = None
    errors = []

    try:
        online_app = online.create_online_application(target_app)
        if online_app:
            _log("DEBUG: online.create_online_application() succeeded")
    except Exception as e:
        err_str = str(e)
        errors.append("Method1(online.create): %s" % err_str)
        _log("DEBUG: Method1 failed: %s" % err_str)

    if not online_app:
        try:
            online_app = target_app.create_online_application()
            if online_app:
                _log("DEBUG: app.create_online_application() succeeded")
        except Exception as e:
            err_str = str(e)
            errors.append("Method2(app.create): %s" % err_str)
            _log("DEBUG: Method2 failed: %s" % err_str)

    if not online_app:
        try:
            import scriptengine as se
            online_app = se.online.create_online_application(target_app)
            if online_app:
                _log("DEBUG: scriptengine.online.create() succeeded")
        except Exception as e:
            err_str = str(e)
            errors.append("Method3(se.online): %s" % err_str)
            _log("DEBUG: Method3 failed: %s" % err_str)

    if not online_app:
        try:
            from scriptengine import online as se_online
            online_app = se_online.create_online_application(target_app)
            if online_app:
                _log("DEBUG: from scriptengine import online succeeded")
        except Exception as e:
            err_str = str(e)
            errors.append("Method4(import online): %s" % err_str)
            _log("DEBUG: Method4 failed: %s" % err_str)

    if not online_app:
        error_summary = "; ".join(errors)
        raise RuntimeError(
            "Could not create online application. Tried 4 methods. Errors: %s. "
            "Ensure CODESYS Gateway V3 service is running and device is configured." % error_summary
        )

    _log("DEBUG: Attempting login...")
    login_ok = False
    login_errors = []

    try:
        online_app.login(OnlineChangeOption.Try, True)
        login_ok = True
        _log("DEBUG: Login(OnlineChangeOption.Try, True) succeeded")
    except Exception as e:
        login_errors.append("Try/True: %s" % str(e))
        _log("DEBUG: Login Try/True failed: %s" % e)

    if not login_ok:
        try:
            online_app.login(OnlineChangeOption.Try, False)
            login_ok = True
            _log("DEBUG: Login(OnlineChangeOption.Try, False) succeeded")
        except Exception as e:
            login_errors.append("Try/False: %s" % str(e))
            _log("DEBUG: Login Try/False failed: %s" % e)

    if not login_ok:
        try:
            online_app.login()
            login_ok = True
            _log("DEBUG: Login() succeeded")
        except Exception as e:
            login_errors.append("NoArgs: %s" % str(e))
            _log("DEBUG: Login no-args failed: %s" % e)

    if not login_ok:
        raise RuntimeError(
            "Login failed after 3 attempts: %s" % "; ".join(login_errors)
        )

    state = str(online_app.application_state)
    _log("DEBUG: Application state after login: %s" % state)

    if state != "run":
        try:
            online_app.start()
            time.sleep(1)
            state = str(online_app.application_state)
            _log("DEBUG: Started application, new state: %s" % state)
        except Exception as e:
            _log("DEBUG: Start failed (non-fatal): %s" % e)

    print("Application: %s" % app_name)
    print("State: %s" % state)
    print("SCRIPT_SUCCESS: Connection established via IPC")
    sys.exit(0)

except SystemExit:
    raise
except Exception as e:
    error_detail = traceback.format_exc()
    print("ERROR: %s" % e)
    print("DETAIL:\n%s" % error_detail)
    print("SCRIPT_ERROR: %s" % e)
    sys.exit(1)
