/*
 * Copyright (c) 2023, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */
import * as fs from 'fs';
import { Uri } from 'vscode';
import * as path from 'path';

type TemplateVariables = { [name: string]: string };

export class CodeBuilder {
    static readonly TEMPLATE_DIR = './resources/templates';
    static readonly QUICK_ACTION_TEMPLATE_NAME = 'quickAction.xml';
    static readonly LWC_DESTINATION_DIR = './force-app/main/default/lwc';
    static readonly QA_DESTINATION_DIR =
        './force-app/main/default/quickActions';
    static readonly TEMPLATE_FILE_EXTENSIONS = [
        'css',
        'html',
        'js',
        'js-meta.xml'
    ];

    private extensionUri: Uri;
    private objectApiName: string;
    private fieldNames: string[];

    templateVariables: TemplateVariables = {};

    constructor(
        extensionUri: Uri,
        objectApiName: string,
        fieldNames: string[]
    ) {
        this.extensionUri = extensionUri;
        this.objectApiName = objectApiName;
        this.fieldNames = fieldNames;
        this.generateTemplateVariables();
    }

    async generateView(): Promise<boolean> {
        return new Promise(async (resolve) => {
            const lwcName = `view${this.objectApiName}Record`;
            this.copyTemplateFiles('viewRecord', lwcName);
            this.createQuickAction('View', lwcName);
            resolve(true);
        });
    }

    async generateEdit(): Promise<boolean> {
        return new Promise(async (resolve) => {
            const lwcName = `edit${this.objectApiName}Record`;
            this.copyTemplateFiles('editRecord', lwcName);
            this.createQuickAction('Edit', lwcName, 'editActionIcon');
            resolve(true);
        });
    }

    async generateCreate(): Promise<boolean> {
        return new Promise(async (resolve) => {
            const lwcName = `create${this.objectApiName}Record`;
            this.copyTemplateFiles('createRecord', lwcName);
            this.createQuickAction('Create', lwcName);
            resolve(true);
        });
    }

    private createQuickAction(
        label: string,
        name: string,
        iconName: string = ''
    ) {
        const templateFilePath = path.join(
            CodeBuilder.TEMPLATE_DIR,
            CodeBuilder.QUICK_ACTION_TEMPLATE_NAME
        );
        const fileContents = this.readFileContents(templateFilePath);

        const quickActionVariables: TemplateVariables = {};
        quickActionVariables['TEMPLATE_QUICK_ACTION_LABEL'] = label;
        quickActionVariables['TEMPLATE_LWC_NAME'] = name;
        if (iconName !== '') {
            quickActionVariables[
                'TEMPLATE_QUICK_ACTION_ICON'
            ] = `<icon>${iconName}</icon>`;
        } else {
            quickActionVariables['TEMPLATE_QUICK_ACTION_ICON'] = '';
        }

        // do substitutions
        const newFileContents = this.replaceAllTemplateVariables(fileContents, {
            ...this.templateVariables,
            ...quickActionVariables
        });

        // copy to destination directory
        const objectApiName =
            this.templateVariables['TEMPLATE_OBJECT_API_NAME'];
        // file name convention example: Account.view.quickAction-meta.xml
        const destinationFile = `${objectApiName}.${label.toLocaleLowerCase()}.quickAction-meta.xml`;

        this.writeFileContents(
            CodeBuilder.QA_DESTINATION_DIR,
            destinationFile,
            newFileContents
        );
    }

    private copyTemplateFiles(template: string, destinationLwc: string) {
        CodeBuilder.TEMPLATE_FILE_EXTENSIONS.forEach((extension) => {
            const templateFilePath = path.join(
                CodeBuilder.TEMPLATE_DIR,
                template,
                `${template}.${extension}`
            );
            const fileContents = this.readFileContents(templateFilePath);

            // do substitutions
            const newFileContents = this.replaceAllTemplateVariables(
                fileContents,
                this.templateVariables
            );

            // copy to destination directory
            const destinationDir = path.join(
                CodeBuilder.LWC_DESTINATION_DIR,
                destinationLwc
            );
            const destinationFile = `${destinationLwc}.${extension}`;

            this.writeFileContents(
                destinationDir,
                destinationFile,
                newFileContents
            );
        });
    }

    private replaceAllTemplateVariables(
        contents: string,
        templateVariables: TemplateVariables
    ) {
        var newFileContents = contents;
        for (const key in templateVariables) {
            if (templateVariables.hasOwnProperty(key)) {
                const value = templateVariables[key];
                newFileContents = newFileContents.replace(
                    `///${key}///`,
                    value
                );
            }
        }
        return newFileContents;
    }

    private readFileContents(filePath: string): string {
        const extensionFilePath = Uri.joinPath(this.extensionUri, filePath);
        try {
            return fs.readFileSync(extensionFilePath.fsPath, 'utf8');
        } catch (err) {
            console.log(`Could not read file ${filePath}`, err);
            return '';
        }
    }

    private writeFileContents(
        dirPath: string,
        filename: string,
        content: string
    ) {
        // ensure dirPath exists
        if (!fs.existsSync(dirPath)) {
            try {
                fs.mkdirSync(dirPath, { recursive: true });
            } catch (err) {
                console.log(`Unable to create directory: ${dirPath}`, err);
                return;
            }
        }
        // write the file
        const filePath = path.join(dirPath, filename);
        try {
            fs.writeFileSync(filePath, content, 'utf8');
        } catch (err) {
            console.error(`Error writing to file ${filePath}`, err);
        }
    }

    /**
     * Ensure all the TEMPLATE_* variables have a value.
     */
    private generateTemplateVariables() {
        this.templateVariables['TEMPLATE_OBJECT_API_NAME'] = this.objectApiName;

        // Labels
        this.templateVariables[
            'TEMPLATE_CREATE_LWC_LABEL'
        ] = `LWC for creating a/an ${this.objectApiName} instance.`;
        this.templateVariables[
            'TEMPLATE_EDIT_LWC_LABEL'
        ] = `LWC for editing a/an ${this.objectApiName} instance.`;
        this.templateVariables[
            'TEMPLATE_VIEW_LWC_LABEL'
        ] = `LWC for viewing a/an ${this.objectApiName} instance.`;

        // We need to populate the following template variables:
        // TEMPLATE_FIELDS - a comma separated list of field names from the import statements, used in viewRecord template.
        //    ie: return [NAME_FIELD, PHONE_FIELD, WEBSITE_FIELD, INDUSTRY_FIELD, TYPE_FIELD];
        // TEMPLATE_IMPORTS - a list of import statements that pulls in the @salesforce/schema fields:
        //    ie: import NAME_FIELD from "@salesforce/schema/Account.Name";
        // TEMPLATE_LIGHTNING_INPUT_CREATE_FIELDS_HTML - fields specified as lightning-input-field values in the create html:
        //    ie: <lightning-input-field field-name={nameField} value={name}></lightning-input-field>
        // TEMPLATE_LIGHTNING_INPUT_EDIT_FIELDS_HTML - fields specified as lightning-input-field values in the edit html
        //    ie: <lightning-input-field field-name={nameField}></lightning-input-field>
        // TEMPLATE_VARIABLES - aliases the imported fields to variables
        //    ie: nameField = NAME_FIELD;
        // TEMPLATE_VARIABLE_ASSIGNMENTS - stores the value of the create fields:
        //    ie: name = "";

        var fields = '';
        var imports = '';
        var createFieldsHtml = '';
        var editFieldsHtml = '';
        var importAliases = '';
        var variableAssignments = '';

        this.fieldNames.forEach((field) => {
            var fieldNameImport = `${field.toUpperCase()}_FIELD`;
            fields += `${fieldNameImport}, `;
            imports += `import ${fieldNameImport} from "@salesforce/schema/${this.objectApiName}.${field}";\n`;

            var fieldNameVariable = `${field.toLowerCase()}Field`;
            importAliases += `${fieldNameVariable} = ${fieldNameImport};\n\t`;
            variableAssignments += `${field.toLowerCase()} = "";\n\t`;
            createFieldsHtml += `<lightning-input-field field-name={${fieldNameVariable}} value={${field.toLowerCase()}}></lightning-input-field>\n\t\t\t\t`;
            editFieldsHtml += `<lightning-input-field field-name={${fieldNameVariable}}></lightning-input-field>\n\t\t\t\t`;
        });
        this.templateVariables['TEMPLATE_FIELDS'] = fields;
        this.templateVariables['TEMPLATE_IMPORTS'] = imports;
        this.templateVariables['TEMPLATE_LIGHTNING_INPUT_CREATE_FIELDS_HTML'] =
            createFieldsHtml;
        this.templateVariables['TEMPLATE_LIGHTNING_INPUT_EDIT_FIELDS_HTML'] =
            editFieldsHtml;
        this.templateVariables['TEMPLATE_VARIABLES'] = importAliases;
        this.templateVariables['TEMPLATE_VARIABLE_ASSIGNMENTS'] =
            variableAssignments;
    }
}
