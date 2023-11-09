/*
 * Copyright (c) 2023, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */

import { Uri, l10n } from 'vscode';
import { access } from 'fs/promises';
import { InstructionsWebviewProvider } from '../../webviews/instructions';
import { UEMParser } from '../../utils/uemParser';
import { WorkspaceUtils } from '../../utils/workspaceUtils';
import { CommonUtils } from '@salesforce/lwc-dev-mobile-core';
import { OrgUtils } from '../../utils/orgUtils';
import * as fs from 'fs';
import { CodeBuilder } from '../../utils/codeBuilder';
import * as path from 'path';

export type QuickActionStatus = {
    view: boolean;
    edit: boolean;
    create: boolean;
};

export type SObjectQuickActionStatus = {
    error?: string;
    sobjects: {
        [name: string]: QuickActionStatus;
    };
};

export type GetSObjectsStatus = {
    error?: string;
    sobjects: string[];
};

export class LwcGenerationCommand {
    extensionUri: Uri;

    constructor(extensionUri: Uri) {
        this.extensionUri = extensionUri;
    }

    static async getSObjectsFromLandingPage(): Promise<GetSObjectsStatus> {
        return new Promise<GetSObjectsStatus>(async (resolve) => {
            const staticResourcesPath =
                await WorkspaceUtils.getStaticResourcesDir();
            const landingPageJson = 'landing_page.json';
            const landingPagePath = path.join(
                staticResourcesPath,
                landingPageJson
            );

            const getSObjectsStatus: GetSObjectsStatus = {
                sobjects: []
            };

            try {
                await access(landingPagePath);
                const uem = CommonUtils.loadJsonFromFile(landingPagePath);
                getSObjectsStatus.sobjects = UEMParser.findSObjects(uem);
            } catch (err) {
                console.warn(
                    `File '${landingPageJson}' does not exist at '${staticResourcesPath}'.`
                );
                getSObjectsStatus.error = (err as Error).message;
            }

            resolve(getSObjectsStatus);
        });
    }

    async createSObjectLwcQuickActions() {
        return new Promise<void>((resolve) => {
            new InstructionsWebviewProvider(
                extensionUri
            ).showInstructionWebview(
                l10n.t('Offline Starter Kit: Create sObject LWC Quick Actions'),
                'resources/instructions/createSObjectLwcQuickActions.html',
                [
                    {
                        type: 'continueButton',
                        action: (panel) => {
                            panel.dispose();
                            return resolve();
                        }
                    },
                    {
                        type: 'generateLwcQuickActionsButton',
                        action: async (panel, _data, callback) => {
                            // TODO: Hook this up to function that parses landing_page.json.
                            const sobjects = [
                                'Account',
                                'Contact',
                                'Opportunity',
                                'SomeOther'
                            ];
                            const quickActionStatus =
                                await LwcGenerationCommand.checkForExistingQuickActions(
                                    sobjects
                                );

                            await this.generateMissingLwcsAndQuickActions(
                                extensionUri,
                                quickActionStatus
                            );

                            // send back updates so UI can be refreshed
                            if (callback) {
                                const quickActionStatus =
                                    await LwcGenerationCommand.checkForExistingQuickActions(
                                        sobjects
                                    );
                                callback(quickActionStatus);
                            }
                        }
                    },
                    {
                        type: 'getQuickActionStatus',
                        action: async (_panel, _data, callback) => {
                            if (callback) {
                                const quickActionStatus =
                                    await LwcGenerationCommand.checkForExistingQuickActions();

                                for (const key in quickActionStatus.sobjects) {
                                    const layoutFields =
                                        await OrgUtils.getCompactLayoutFieldsForSObject(
                                            key
                                        );
                                }

                                callback(quickActionStatus);
                            }
                        }
                    }
                ]
            );
        });
    }

    static async checkForExistingQuickActions(): Promise<SObjectQuickActionStatus> {
        return new Promise<SObjectQuickActionStatus>(async (resolve) => {
            const results: SObjectQuickActionStatus = { sobjects: {} };

            const sObjectsStatus = await this.getSObjectsFromLandingPage();
            if (sObjectsStatus.error) {
                results.error = sObjectsStatus.error;
                return resolve(results);
            }

            sObjectsStatus.sobjects.forEach((sobject) => {
                const quickActionStatus: QuickActionStatus = {
                    view: false,
                    edit: false,
                    create: false
                };
                quickActionStatus.view =
                    LwcGenerationCommand.checkForExistingQuickAction(
                        sobject,
                        'view'
                    );
                quickActionStatus.edit =
                    LwcGenerationCommand.checkForExistingQuickAction(
                        sobject,
                        'edit'
                    );
                quickActionStatus.create =
                    LwcGenerationCommand.checkForExistingQuickAction(
                        sobject,
                        'create'
                    );

                results.sobjects[sobject] = quickActionStatus;
            });

            return resolve(results);
        });
    }

    static async generateMissingLwcsAndQuickActions(
        extensionUri: Uri,
        quickActionStatus: SObjectQuickActionStatus
    ): Promise<SObjectQuickActionStatus> {
        return new Promise<SObjectQuickActionStatus>(async (resolve) => {
            for (const sobject in quickActionStatus.sobjects) {
                const quickActions = quickActionStatus.sobjects[sobject];

                if (
                    !quickActions.create ||
                    !quickActions.edit ||
                    !quickActions.view
                ) {
                    // at least 1 needs to be creaed
                    // TODO: Hook up to compact layout to obtain list of field names to use
                    const codeBuilder = new CodeBuilder(extensionUri, sobject, [
                        'Name',
                        'AccountId'
                    ]);

                    if (!quickActions.view) {
                        await codeBuilder.generateView();
                    }

                    if (!quickActions.edit) {
                        await codeBuilder.generateEdit();
                    }

                    if (!quickActions.create) {
                        await codeBuilder.generateCreate();
                    }
                }
            }

            // Just double check now that things have been created.
            const newStatus =
                await LwcGenerationCommand.checkForExistingQuickActions(
                    Object.keys(quickActionStatus.sobjects)
                );
            resolve(newStatus);
        });
    }

    private static checkForExistingQuickAction(
        sobject: string,
        qaName: string
    ): boolean {
        const expectedMetadataFilename = `${sobject}.${qaName}.quickAction-meta.xml`;
        try {
            // Check if the qa directory exists
            const stats = fs.statSync(
                `force-app/main/default/quickActions/${expectedMetadataFilename}`
            );
            return stats.isFile();
        } catch (error) {
            // If an error occurs, the directory does not exist
            return false;
        }
    }
}
