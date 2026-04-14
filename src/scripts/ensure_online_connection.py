import traceback
import time

def _find_device_for_app(app_obj):
    parent = app_obj.parent
    while parent is not None:
        if hasattr(parent, 'is_device') and parent.is_device:
            return parent
        parent = parent.parent
    return None

def ensure_online_connection(primary_project):
    print("DEBUG: Ensuring online connection...")

    target_app = None
    app_name = "N/A"

    try:
        target_app = primary_project.active_application
        if target_app:
            app_name = getattr(target_app, 'get_name', lambda: "Unnamed App")()
    except Exception as e:
        print("WARN: Could not get active application: %s" % e)

    if not target_app:
        try:
            all_children = primary_project.get_children(True)
            for child in all_children:
                if hasattr(child, 'is_application') and child.is_application:
                    target_app = child
                    app_name = getattr(child, 'get_name', lambda: "Unnamed App")()
                    break
        except Exception as e:
            print("WARN: Error finding application: %s" % e)

    if not target_app:
        raise RuntimeError("No application found in project.")

    print("DEBUG: Using application: %s" % app_name)

    online_app = None

    try:
        online_app = online.create_online_application(target_app)
        if online_app:
            print("DEBUG: Created online application via online.create_online_application()")
    except Exception as e:
        print("DEBUG: online.create_online_application() failed: %s" % e)

    if not online_app:
        try:
            online_app = target_app.create_online_application()
            if online_app:
                print("DEBUG: Created online application via app.create_online_application()")
        except Exception as e:
            print("DEBUG: app.create_online_application() failed: %s" % e)

    if not online_app:
        try:
            from scriptengine import online as _online_mod
            online_app = _online_mod.create_online_application(target_app)
            if online_app:
                print("DEBUG: Created online application via scriptengine.online")
        except Exception as e:
            print("DEBUG: scriptengine.online.create_online_application() failed: %s" % e)

    if not online_app:
        if hasattr(target_app, 'online_application'):
            try:
                online_app = target_app.online_application
                if online_app:
                    print("DEBUG: Found existing online application via app.online_application")
            except Exception as e:
                print("DEBUG: app.online_application failed: %s" % e)

    if not online_app:
        raise RuntimeError(
            "Could not create online application connection. "
            "Ensure a device/gateway is configured in the project and "
            "this script runs via --runscript (not IPC exec())."
        )

    login_needed = False
    try:
        if hasattr(online_app, 'is_logged_in'):
            login_needed = not online_app.is_logged_in
        else:
            login_needed = True
    except:
        login_needed = True

    if login_needed:
        print("DEBUG: Not logged in. Attempting login...")
        try:
            online_app.login(OnlineChangeOption.Try, True)
            print("DEBUG: Login successful with OnlineChangeOption.Try, True")
        except Exception as e1:
            print("DEBUG: Login with OnlineChangeOption.Try failed: %s" % e1)
            try:
                online_app.login(OnlineChangeOption.Try, False)
                print("DEBUG: Login successful with OnlineChangeOption.Try, False")
            except Exception as e2:
                print("DEBUG: Login with Try/False failed: %s" % e2)
                try:
                    online_app.login()
                    print("DEBUG: Login successful with no arguments")
                except Exception as e3:
                    print("WARN: All login attempts failed: %s" % e3)

    return online_app, target_app
