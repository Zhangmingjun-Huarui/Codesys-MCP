# encoding:utf-8
from __future__ import print_function
import sys

output_file = r"D:\Codesys-MCP-main\Codesys-MCP-main\variable_value.txt"

def log(msg):
    with open(output_file, "a") as f:
        f.write(msg + "\n")
    print(msg)

try:
    if projects.primary:
        projects.primary.close()

    proj = projects.open(r"D:\Codesys-MCP-main\Codesys-MCP-main\AccumulatorProject.project")
    log("Project opened: %s" % proj.path)

    app = proj.active_application
    log("Active application: %s" % app.get_name())

    onlineapp = online.create_online_application(app)
    log("Online app created.")

    onlineapp.login(OnlineChangeOption.Try, True)
    log("Login successful.")

    if not onlineapp.application_state == ApplicationState.run:
        onlineapp.start()
        log("Application started.")
    else:
        log("Application already running.")

    system.delay(500)

    value = onlineapp.read_value("PLC_PRG.nAccumulator")
    log("nAccumulator: %s" % value)

    cycle = onlineapp.read_value("PLC_PRG.nCycleCount")
    log("nCycleCount: %s" % cycle)

    enable = onlineapp.read_value("PLC_PRG.bEnable")
    log("bEnable: %s" % enable)

    step = onlineapp.read_value("PLC_PRG.nStep")
    log("nStep: %s" % step)

    maxval = onlineapp.read_value("PLC_PRG.nMaxValue")
    log("nMaxValue: %s" % maxval)

    onlineapp.logout()
    log("Logged out.")

    proj.close()
    log("SCRIPT_SUCCESS")
except Exception as e:
    log("ERROR: %s" % str(e))
    import traceback
    log(traceback.format_exc())
    try:
        proj.close()
    except:
        pass
    sys.exit(1)
