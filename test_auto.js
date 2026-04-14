const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const CODESYS_PATH = 'C:\\Program Files\\CODESYS 3.5.19.50\\CODESYS\\Common\\CODESYS.exe';
const CODESYS_PROFILE = 'CODESYS V3.5 SP19 Patch 5';
const PROJECT_DIR = 'D:\\Codesys-MCP-Test';
const PROJECT_FILE = `${PROJECT_DIR}\\PersistentDataTest.project`;
const SERVER_PATH = require('path').join(__dirname, 'dist', 'bin.js');
const fs = require('fs');
const path = require('path');

const TEST_PROGRAMS_DIR = path.join(__dirname, 'test_programs');

function readStFile(name) {
  return fs.readFileSync(path.join(TEST_PROGRAMS_DIR, name), 'utf-8').trim();
}

async function callTool(client, name, args, timeoutMs = 120000) {
  console.log(`  [CALL] ${name}(${JSON.stringify(args).substring(0, 120)}...)`);
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
  const text = result.content?.[0]?.text || '';
  const isError = result.isError || false;
  if (isError) {
    console.log(`  [FAIL] ${name}: ${text.substring(0, 200)}`);
  } else {
    console.log(`  [OK]   ${name}: ${text.substring(0, 200)}`);
  }
  return { text, isError };
}

async function main() {
  console.log('========================================');
  console.log('  CODESYS MCP Persistent Mode Test');
  console.log('  Automated Data Persistence Test');
  console.log('========================================\n');

  console.log('[1/8] Connecting to MCP server...');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [
      SERVER_PATH,
      '--codesys-path', CODESYS_PATH,
      '--codesys-profile', CODESYS_PROFILE,
      '--mode', 'persistent',
      '--workspace', PROJECT_DIR,
      '--verbose',
    ],
  });

  const client = new Client({ name: 'test-client', version: '1.0.0' }, {
    capabilities: {},
  });
  await client.connect(transport);
  console.log('  Connected to MCP server.\n');

  try {
    console.log('[2/8] Checking CODESYS status...');
    let result = await callTool(client, 'get_codesys_status', {});
    console.log('');

    console.log('[3/8] Creating project...');
    if (fs.existsSync(PROJECT_FILE)) {
      fs.unlinkSync(PROJECT_FILE);
    }
    const templatePath = 'C:\\Program Files\\CODESYS 3.5.19.50\\CODESYS\\Templates\\Standard.project';
    const upgradedTemplate = 'D:\\Codesys-MCP-Test\\Standard_3519.project';
    if (fs.existsSync(upgradedTemplate)) {
      fs.copyFileSync(upgradedTemplate, PROJECT_FILE);
      console.log('  Copied upgraded template project.');
    } else if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, PROJECT_FILE);
      console.log('  Copied standard template project (will upgrade on first open).');
    }
    result = await callTool(client, 'open_project', { filePath: PROJECT_FILE }, 180000);
    if (result.isError) throw new Error('Failed to open project');
    console.log('  Saving project to upgrade format...');
    await callTool(client, 'save_project', { projectFilePath: PROJECT_FILE });
    if (!fs.existsSync(upgradedTemplate) && fs.existsSync(PROJECT_FILE)) {
      fs.copyFileSync(PROJECT_FILE, upgradedTemplate);
      console.log('  Saved upgraded template for future use.');
    }
    console.log('');

    console.log('[4/8] Creating DUT (ST_DataRecord)...');
    result = await callTool(client, 'create_dut', {
      projectFilePath: PROJECT_FILE,
      name: 'ST_DataRecord',
      dutType: 'Structure',
      parentPath: 'Application',
    });
    console.log('');

    console.log('[5/8] Creating GVL (GVL_Test)...');
    const gvlDecl = readStFile('GVL_Test_decl.st');
    result = await callTool(client, 'create_gvl', {
      projectFilePath: PROJECT_FILE,
      name: 'GVL_Test',
      parentPath: 'Application',
      declarationCode: gvlDecl,
    });
    console.log('');

    console.log('[6/8] Creating POUs and setting code...');

    console.log('  Creating FB_PersistentData...');
    result = await callTool(client, 'create_pou', {
      projectFilePath: PROJECT_FILE,
      name: 'FB_PersistentData',
      type: 'FunctionBlock',
      language: 'ST',
      parentPath: 'Application',
    });

    console.log('  Setting FB_PersistentData code...');
    const fbDecl = readStFile('FB_PersistentData_decl.st');
    const fbImpl = readStFile('FB_PersistentData_impl.st');
    result = await callTool(client, 'set_pou_code', {
      projectFilePath: PROJECT_FILE,
      pouPath: 'Application/FB_PersistentData',
      declarationCode: fbDecl,
      implementationCode: fbImpl,
    });

    console.log('  Handling PLC_PRG (template already has one)...');
    result = await callTool(client, 'delete_object', {
      projectFilePath: PROJECT_FILE,
      objectPath: 'Application/PLC_PRG',
    });
    console.log(`  Deleted existing PLC_PRG: ${result.isError ? 'skip' : 'ok'}`);

    result = await callTool(client, 'create_pou', {
      projectFilePath: PROJECT_FILE,
      name: 'PLC_PRG',
      type: 'Program',
      language: 'ST',
      parentPath: 'Application',
    });
    console.log(`  Created new PLC_PRG: ${result.isError ? 'may already exist' : 'ok'}`);

    console.log('  Setting PLC_PRG code...');
    const prgDecl = readStFile('PLC_PRG_decl.st');
    const prgImpl = readStFile('PLC_PRG_impl.st');
    result = await callTool(client, 'set_pou_code', {
      projectFilePath: PROJECT_FILE,
      pouPath: 'Application/PLC_PRG',
      declarationCode: prgDecl,
      implementationCode: prgImpl,
    });
    console.log('');

    console.log('[7/8] Compiling project...');
    result = await callTool(client, 'compile_project', {
      projectFilePath: PROJECT_FILE,
    }, 180000);
    const compileOk = !result.isError;
    console.log(`  Compilation result: ${compileOk ? 'SUCCESS' : 'FAILED'}`);
    if (!compileOk) {
      console.log(`  Full error output:`);
      console.log(result.text);
    }
    console.log('');

    if (compileOk) {
      console.log('[8/8] Reading back project code to verify...');
      result = await callTool(client, 'get_all_pou_code', {
        projectFilePath: PROJECT_FILE,
      });
      if (!result.isError) {
        console.log('  Project code retrieved successfully.');
        console.log('  Code preview (first 500 chars):');
        console.log('  ' + result.text.substring(0, 500).replace(/\n/g, '\n  '));
      }
    }

    console.log('\n========================================');
    console.log('  Test Summary');
    console.log('========================================');
    console.log(`  Project created: ${PROJECT_FILE}`);
    console.log(`  Compilation: ${compileOk ? 'PASSED' : 'FAILED'}`);
    console.log('');
    console.log('  Next steps for runtime testing:');
    console.log('  1. Configure a device/gateway in CODESYS');
    console.log('  2. Use connect_to_device to login');
    console.log('  3. Use download_to_device to deploy');
    console.log('  4. Use start_stop_application to start');
    console.log('  5. Use read_variable/write_variable to test');
    console.log('  6. Stop and restart to verify RETAIN persistence');
    console.log('');

  } catch (err) {
    console.error(`\nFATAL ERROR: ${err.message}`);
  } finally {
    console.log('Shutting down CODESYS...');
    try {
      await callTool(client, 'shutdown_codesys', {});
    } catch {}
    await client.close();
    console.log('Done.');
  }
}

main().catch(console.error);
