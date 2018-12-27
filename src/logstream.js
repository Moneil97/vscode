// MIT License
//
// Copyright 2018 Electric Imp
//
// SPDX-License-Identifier: MIT
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
// EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
// OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
// ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.


const path = require('path');
const colors = require('colors/safe');
const strftime = require('strftime');
const vscode = require('vscode');
const ImpCentralApi = require('imp-central-api');
const User = require('./user');
const Auth = require('./auth');
const Workspace = require('./workspace');

/*
 * Here we will have all logic related with logstreams manipulation.
 * Currently the class functions do nothing, but the appropriate command is exported.
 * The command uses vscode outputChannel api to print hello-like message for now.
 */

class LogStream {
    constructor(diagnostic) {
        this.diagnostic = diagnostic;
        this.logStreamID = undefined;
        this.outputChannel = undefined;
        this.devices = new Set();
        this.pause = false;
    }

    static getTypeInfo(type) {
        const typeInfo = {
            name: undefined,
            className: '',
        };

        switch (type) {
        case 'server.log':
            typeInfo.name = 'Device';
            typeInfo.className = 'device-log';
            break;
        case 'server.error':
            typeInfo.name = 'Device';
            typeInfo.className = 'device-error';
            break;
        case 'server.sleep':
            typeInfo.name = 'Device';
            typeInfo.className = 'device-sleep';
            break;
        case 'agent.log':
            typeInfo.name = 'Agent';
            typeInfo.className = 'agent-log';
            break;
        case 'agent.error':
            typeInfo.name = 'Agent';
            typeInfo.className = 'agent-error';
            break;
        case 'status':
            typeInfo.name = 'Status';
            typeInfo.className = 'status';
            break;
        case 'powerstate':
            typeInfo.name = 'Power State';
            typeInfo.className = 'power-state';
            break;
        case 'lastexitcode':
            typeInfo.name = 'Exit Code';
            typeInfo.className = 'last-exit-code';
            break;
        case 'firmware':
            typeInfo.name = 'Firmware';
            typeInfo.className = 'firmware';
            break;
        case 'IDE.log':
            typeInfo.name = 'IDE';
            typeInfo.className = 'ide-log';
            break;
        default:
            return undefined;
        }

        return typeInfo;
    }

    static getTypeString(typeInfo) {
        switch (typeInfo.className) {
        case 'device-log':
            return `[${typeInfo.name}]`;
        case 'device-sleep':
            return `[${typeInfo.name}]`;
        case 'device-error':
            return `[${typeInfo.name}]`;
        case 'agent-log':
            return `[${typeInfo.name}] `;
        case 'agent-error':
            return `[${typeInfo.name}] `;
        case 'status':
            return `[${typeInfo.name}]`;
        case 'power-state':
            return `[${typeInfo.name}]`;
        case 'last-exit-code':
            return `[${typeInfo.name}]`;
        case 'firmware':
            return `[${typeInfo.name}]`;
        case 'ide-log':
            return `[${typeInfo.name}]`;
        default:
            return undefined;
        }
    }

    static getTypeStringColorized(typeInfo) {
        switch (typeInfo.className) {
        case 'device-log':
            return colors.blue(`[${typeInfo.name}]`);
        case 'device-sleep':
            return colors.blue(`[${typeInfo.name}]`);
        case 'device-error':
            return colors.bgBlack.white(`[${typeInfo.name}]`);
        case 'agent-log':
            return colors.cyan(`[${typeInfo.name}]`);
        case 'agent-error':
            return colors.bgCyan.black(`[${typeInfo.name}]`);
        case 'status':
            return colors.yellow(`[${typeInfo.name}]`);
        case 'power-state':
            return colors.green(`[${typeInfo.name}]`);
        case 'last-exit-code':
            return colors.red(`[${typeInfo.name}]`);
        case 'firmware':
            return colors.magenta(`[${typeInfo.name}]`);
        case 'ide-log':
            return colors.yellow(`[${typeInfo.name}]`);
        default:
            return undefined;
        }
    }

    replaceFileNameToLink(msg) {
        const haveAgent = msg.indexOf('agent_code') > -1;
        const haveDevice = msg.indexOf('device_code') > -1;
        if (haveAgent === false && haveDevice === false) {
            return msg;
        }

        if (this.diagnostic.pre) {
            const regex = /.*((?:device_code|agent_code)):(\d+)/;
            const result = msg.match(regex);
            if (result == null) {
                return msg;
            }

            const src = this.diagnostic.getSource(result[1]);
            if (src === undefined) {
                return msg;
            }

            const loc = src.pre.getErrorLocation(parseInt(result[2], 10) - 1);
            const fullPath = path.join(path.dirname(src.file), loc[0]);

            return `${msg.replace(`${result[1]}:${result[2]}`, `${fullPath}:${loc[1]}`)}:0`;
        }

        const paths = Workspace.Data.getSourcesPathsSync();
        if (haveAgent) {
            return `${msg.replace('agent_code', paths.agent_path)}:0`;
        } else if (haveDevice) {
            return `${msg.replace('device_code', paths.device_path)}:0`;
        }

        return msg;
    }

    getLogStreamLogMessage(message) {
        const regex = /\b[0-9a-f]{16}\s(.*)\s(?:development|production)\s([a-z.]+)\s(.*)/;
        const result = message.match(regex);
        if (result == null) {
            // If we can not parse the message, return it as is.
            return message;
        }

        const ts = strftime('%Y-%m-%d %H:%M:%S%z');
        const type = LogStream.getTypeString(LogStream.getTypeInfo(result[2]));
        const msg = this.replaceFileNameToLink(result[3]);

        return `${ts} ${type} ${msg}`;
    }

    getErrorMessage(message) {
        const regex = /\b[0-9a-f]{16}\s(.*)\s(?:development|production)\s([a-z.]+)\sERROR:(.*)/;
        const result = message.match(regex);
        if (result == null || this.diagnostic.pre === undefined) {
            return undefined;
        }

        const errMsg = result[3];
        const reg = /(.*):(\d+)/;
        const res = errMsg.match(reg);
        if (errMsg.indexOf('agent_code') > -1) {
            return {
                source: 'agent_code',
                file: this.diagnostic.getSource('agent_code').file,
                line: res[2],
            };
        } else if (errMsg.indexOf('device_code') > -1) {
            return {
                source: 'device_code',
                file: this.diagnostic.getSource('device_code').file,
                line: res[2],
            };
        }

        return undefined;
    }

    logMsg(message) {
        if (this.pause) {
            return;
        }

        const err = this.getErrorMessage(message);
        if (err) {
            this.diagnostic.addLogStreamError(err);
        }

        /*
            * If we get message like 'Downloading new code'.
            * It mean that we should clean the diagnostic collection
            * to report the actual problems from fresh deploy.
            */
        const regex = /.*(Downloading new code).*(program storage used)/;
        const result = message.match(regex);
        if (result) {
            this.diagnostic.clearDiagnostic();
        }

        this.outputChannel.appendLine(this.getLogStreamLogMessage(message));
    }

    logState(message) {
        /*
         * Do not print state messages for now.
         */
        const doNotPrintState = true;
        if (doNotPrintState) {
            return;
        }

        if (this.pause) {
            return;
        }

        this.outputChannel.appendLine(message);
    }

    isOpened() {
        return this.logStreamID && this.outputChannel;
    }

    static promptDeviceID() {
        return new Promise(((resolve, reject) => {
            vscode.window.showInputBox({ prompt: User.MESSAGES.DEVICE_PROMPT_DEVICE_ID })
                .then((deviceID) => {
                    if (!deviceID) {
                        vscode.window.showErrorMessage(User.ERRORS.DEVICE_ID_EMPTY);
                        reject();
                        return;
                    }

                    resolve(deviceID);
                });
        }));
    }

    impAddDevice(impCentralApi, deviceID) {
        impCentralApi.logStreams.addDevice(this.logStreamID, deviceID)
            .then(() => {
                this.outputChannel.show(true);
                this.devices.add(deviceID);
                vscode.window.showInformationMessage(`Device added: ${deviceID}`);
            }, (err) => {
                User.showImpApiError(`The device ${deviceID} cannot be added:`, err);
            });
    }

    addDevice(accessToken, deviceID) {
        return new Promise(((resolve) => {
            const api = new ImpCentralApi();
            api.auth.accessToken = accessToken;
            if (this.isOpened() === undefined) {
                api.logStreams.create(this.logMsg.bind(this), this.logState.bind(this))
                    .then((logStream) => {
                        this.logStreamID = logStream.data.id;
                        this.outputChannel =
                            vscode.window.createOutputChannel(User.NAMES.OUTPUT_CHANNEL);
                        this.impAddDevice(api, deviceID);
                        resolve();
                    }, (err) => {
                        User.showImpApiError(`Cannot open ${User.NAMES.OUTPUT_CHANNEL}`, err);
                    });
            } else {
                this.impAddDevice(api, deviceID);
                resolve();
            }
        }));
    }

    addDevicePrompt(accessToken) {
        LogStream.promptDeviceID()
            .then((deviceID) => {
                this.addDevice(accessToken, deviceID);
            });
    }

    // Add device to LogStream and send it's logs to the outputChannel.
    //
    // Parameters:
    //     none
    addDeviceDialog() {
        Auth.authorize().then(this.addDevicePrompt.bind(this));
    }

    impRemoveDevice(impCentralApi, deviceID) {
        impCentralApi.logStreams.removeDevice(this.logStreamID, deviceID)
            .then(() => {
                this.devices.delete(deviceID);
                vscode.window.showInformationMessage(`Device removed: ${deviceID}`);
            }, (err) => {
                User.showImpApiError(`The device ${deviceID} cannot be removed:`, err);
            });
    }

    removeDevice(accessToken) {
        if (this.isOpened() === undefined) {
            vscode.window.showErrorMessage(`Cannot remove device from ${User.NAMES.OUTPUT_CHANNEL}`);
            return;
        }

        LogStream.promptDeviceID()
            .then((deviceID) => {
                const api = new ImpCentralApi();
                api.auth.accessToken = accessToken;
                this.impRemoveDevice(api, deviceID);
            });
    }

    // Remove device from LogStream.
    //
    // Parameters:
    //     none
    removeDeviceDialog() {
        Auth.authorize().then(this.removeDevice.bind(this));
    }

    // Clear LogStream output window.
    //
    // Parameters:
    //     none
    clearLogOutput() {
        if (this.isOpened() === undefined) {
            vscode.window.showErrorMessage(`Cannot clear ${User.NAMES.OUTPUT_CHANNEL}`);
            return;
        }

        this.outputChannel.clear();
    }

    // Pause LogStream output window
    //
    // Parameters:
    //     none
    pauseLogOutput() {
        if (this.isOpened() === undefined) {
            vscode.window.showErrorMessage(`Cannot pause ${User.NAMES.OUTPUT_CHANNEL}`);
            return;
        }

        this.pause = !this.pause;
    }
}
module.exports = LogStream;
