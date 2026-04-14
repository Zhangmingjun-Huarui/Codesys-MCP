import sys, scriptengine as script_engine, os, traceback

try:
    primary_project = script_engine.projects.primary
    if not primary_project:
        print("ERROR: No primary project open.")
        sys.exit(1)

    print("DEBUG: Project path: %s" % primary_project.path)

    def print_device_tree(obj, indent=0):
        indent_str = "  " * indent
        try:
            name = getattr(obj, 'get_name', lambda: "Unnamed")()
            obj_type = type(obj).__name__
            is_device = getattr(obj, 'is_device', False)
            device_id = ""
            if is_device:
                try:
                    di = obj.get_device_identification()
                    device_id = " [DeviceId: %s]" % str(di)
                except:
                    device_id = " [DeviceId: ERROR]"
            print("%s- %s (%s)%s" % (indent_str, name, obj_type, device_id))

            if hasattr(obj, 'get_children'):
                for child in obj.get_children(False):
                    print_device_tree(child, indent + 1)
        except Exception as e:
            print("%s- ERROR: %s" % (indent_str, e))

    print("")
    print("--- DEVICE TREE ---")
    for top_obj in primary_project.get_children():
        print_device_tree(top_obj)
    print("--- END DEVICE TREE ---")

    print("")
    print("--- CHECKING ACTIVE APPLICATION ---")
    app = primary_project.active_application
    if app:
        print("Active application: %s" % app.get_name())
        print("App type: %s" % type(app).__name__)

        parent = app.parent
        if parent:
            print("App parent: %s (%s)" % (parent.get_name(), type(parent).__name__))
            if hasattr(parent, 'is_device') and parent.is_device:
                try:
                    di = parent.get_device_identification()
                    print("Parent device ID: %s" % str(di))
                except:
                    print("Parent device ID: ERROR getting ID")

                try:
                    comm = parent.get_communication_channel()
                    print("Communication channel: %s" % str(comm))
                except:
                    print("Communication channel: not available or error")
    else:
        print("No active application found!")

    print("")
    print("--- TRYING ONLINE CONNECTION ---")
    try:
        online_app = script_engine.online.create_online_application(app)
        print("SUCCESS: online.create_online_application() worked!")
        print("Online app type: %s" % type(online_app).__name__)
    except Exception as e:
        print("FAILED: script_engine.online.create_online_application(): %s" % e)

    print("SCRIPT_SUCCESS: Diagnostics complete.")
    sys.exit(0)
except Exception as e:
    print("ERROR: %s" % e)
    traceback.print_exc()
    sys.exit(1)
