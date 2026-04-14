# encoding:utf-8
from __future__ import print_function

if projects.primary:
    projects.primary.close()

proj = projects.open(r"D:\Codesys-MCP-main\Codesys-MCP-main\AccumulatorProject.project")
app = proj.active_application

print("Application: %s" % app.get_name())

onlineapp = online.create_online_application(app)
print("Online app created successfully!")

onlineapp.login(OnlineChangeOption.Try, True)
print("Login successful!")

if not onlineapp.application_state == ApplicationState.run:
    onlineapp.start()
    print("Application started!")

system.delay(1000)

value = onlineapp.read_value("PLC_PRG.nAccumulator")
print("nAccumulator value: %s" % value)

cycle = onlineapp.read_value("PLC_PRG.nCycleCount")
print("nCycleCount value: %s" % cycle)

onlineapp.logout()
proj.close()
print("SCRIPT_SUCCESS: All operations completed successfully.")
