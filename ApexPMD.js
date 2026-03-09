const admZip = require('adm-zip');
const fs = require('fs');
const jsforce = require('jsforce');
const child_process = require('child_process');
const path = require('path');
const { getProxyForUrl } = require('proxy-from-env')


const NAME_SPACE_PREFIX = process.env.NODE_ENV === 'development' ? '' : 'Flosum__';
const URL_POST = process.env.NODE_ENV === 'development' ? '/async' : '/Flosum/async';
const CHUNK_SIZE = process.env.CHUNK_SIZE || 30;

class ApexPMD {

    instUrl;
    accessToken;
    attList;
    jobId;
    branchId;
    attRuls;
    numberIssuesJob = 0;
    stateJob = 'COMPLETED';
    commentJob;
    attId;
    violList;
    mapRuls;
    subArray;
    isContinue;

    constructor(instUrl, accessToken, jobId, attList, attRuls, branchId) {
        this.instUrl = instUrl;
        this.accessToken = accessToken;
        this.attList = attList;
        this.attRuls = attRuls;
        this.branchId = branchId;

        const httpProxy = getProxyForUrl(this.instUrl)

        console.log('Proxy URL:', httpProxy ? httpProxy : 'No proxy configured');

        if (process.env.sf_token) {
            const token = process.env.sf_token.split(' ');
            this.connSourceOrg = new jsforce.Connection({
                oauth2: {
                    loginUrl: this.instUrl,
                    clientId: token[1],
                    clientSecret: token[2]
                },
                instanceUrl: this.instUrl,
                refreshToken: token[0],
                httpProxy
            });
        } else {
            this.connSourceOrg = new jsforce.Connection({
                serverUrl: this.instUrl,
                sessionId: this.accessToken,
                httpProxy
            });
        }
        this.jobId = jobId;
        this.mapRuls = [];
        this.violList = [];
        this.subArray = [];
        this.isContinue = true;
    }

    async getAttachment() {
        try {
            let self = this;
            console.log('Start getting attachment');
            let size = 100;
            let partSubArray = [];
            if (self.subArray.length == 0) {
                for (let i = 0; i < Math.ceil(self.attList.length / size); i++) {
                    self.subArray[i] = self.attList.slice((i * size), (i * size) + size);
                }
            }
            partSubArray = self.subArray.splice(0, CHUNK_SIZE);
            if (self.subArray.length == 0) {
                self.isContinue = false;
            }
            var count = partSubArray.length;
            for (let i = 0; i < partSubArray.length; i++) {
                let bodyPost = { opType: "ATTACHMENT", attachment: JSON.stringify(partSubArray[i]) }; //,"00P5g000000y28QEAQ"
                const result = await self.connSourceOrg.apex.post(URL_POST, bodyPost);

                const mapBody = JSON.parse(result);
                const tmpFolder = `./${this.jobId}/`;
                if (!fs.existsSync(tmpFolder)) {
                    fs.mkdirSync(tmpFolder);
                }

                for (const [fileName, base64Data] of Object.entries(mapBody)) {
                    const buff = Buffer.from(base64Data, 'base64');
                    const zip = new admZip(buff);
                    const zipEntries = zip.getEntries();

                    zipEntries.forEach((zipEntry) => {
                        if (zipEntry.name && zipEntry.name !== '') {
                            const filePath = path.join(tmpFolder, zipEntry.name);
                            fs.writeFileSync(filePath, zipEntry.getData().toString('utf8'));
                        }
                    });
                }
                count--;
            }
            if (count == 0) {
                console.log('End getting attachment');
                return 'success';
            }

        } catch (e) {
            let self = this;
            self.isContinue = false;
            console.log('Error getting attachment' + e.message);
            await self.createErrorLog('Error getting attachment' + e.message);
            throw new Error('Failed to get attachment');
        }
    }

    async getRuls() {
        try {
            let self = this;
            console.log('Start getting rules');
            if (self.attRuls != null) {
                let bodyPost = { opType: "RULES", attachment: self.attRuls }; //,"00P5g000000y28QEAQ"
                const result = await this.connSourceOrg.apex.post(URL_POST, bodyPost);

                const text = Buffer.from(result, 'base64').toString('ascii');
                if (text === 'Null attachment') {
                    this.isContinue = false;
                    console.log('Error getting rules: attachment not found.');
                    await self.createErrorLog('Error getting rules: attachment not found.');
                    throw new Error('Attachment not found');
                }
                const tmpFolder = `./${this.jobId}/`;
                fs.writeFileSync(path.join(tmpFolder, 'ruls.xml'), text);
                fs.writeFileSync(
                    path.join(tmpFolder, 'sfdx-project.json'),
                    JSON.stringify({
                        packageDirectories: [{ path: '', default: true }]
                    })
                );

                console.log('End getting rules');
                return 'success';
            } else {
                self.isContinue = false;
                console.log('Error getting rules: null attachment Id.');
                await self.createErrorLog('Error getting rules: null attachment Id.');
                throw new Error('Null attachment Id');
            }
        } catch (e) {
            let self = this;
            self.isContinue = false;
            console.log('Error getting rules' + e.message);
            await self.createErrorLog('Error getting rules' + e.message);
            throw new Error('Failed to get rules');
        }
    }

    async runPMD() {
        const self = this;
        try {
            console.log('runPMD');
            const jobPath = './' + self.jobId;
            const rulesPath = jobPath + '/ruls.xml';
            const reportPath = jobPath + '/result.csv';

            if (!fs.existsSync(jobPath)) {
                console.log('Files for PMD analysis not found');
                self.isContinue = false;
                await self.createErrorLog('Files for PMD analysis not found');
                throw new Error('Files not found');
            }

            if (!fs.existsSync(rulesPath)) {
                console.log('PMD analysis rules file not found');
                self.isContinue = false;
                await self.createErrorLog('PMD analysis rules file not found');
                throw new Error('Rules file not found');
            }

            const cmd =
                'bash dist/pmd-bin/bin/pmd check ' +
                '--no-fail-on-violation ' +
                `--dir ${jobPath}/ ` +
                '--format csv ' +
                `--report-file ${reportPath} ` +
                `--rulesets ${rulesPath} ` +
                '--property problem=false ' +
                '--property package=false ' +
                '--property ruleSet=false ' +
                `--relativize-paths-with ${jobPath}/ ` +
                '--threads 0';

            const result = child_process.execSync(cmd, {
                env: {
                    ...process.env,
                    PMD_APEX_ROOT_DIRECTORY: './' + self.jobId
                },
                stdio: 'pipe',
                encoding: 'utf-8'
            });

            console.log('PMD analysis output:\n', result);
            console.log('PMD analysis finished');
            return 'success';
        } catch (e) {
            const message = e?.message || 'Unknown error';
            const stderr = e?.stderr && typeof e.stderr.toString === 'function'
                ? e.stderr.toString()
                : 'No stderr output';

            const stdout = e?.stdout && typeof e.stdout.toString === 'function'
                ? e.stdout.toString()
                : 'No stdout output';

            console.log('Caught error:', message);
            console.log('PMD stderr:\n', stderr);
            console.log('PMD stdout:\n', stdout);

            if (fs.existsSync('./' + self.jobId + '/result.csv')) {
                return 'Completed with errors';
            } else {
                self.isContinue = false;
                await self.createErrorLog(`PMD failed:\n${message}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`);
                throw e;
            }
        }
    }

    async saveResults() {
        try {
            let self = this;
            console.log('Start save results');
            const resultFile = path.join(`./${this.jobId}`, 'result.csv');
            if (fs.existsSync(resultFile)) {
                let content = fs.readFileSync(resultFile);
                let lines = content.toString().split("\n");

                for (let i = 1; i < lines.length - 1; i++) {
                    let violationStrings = lines[i].split('\",\"');
                    self.violList.push({
                        name: violationStrings[0].substring(violationStrings[0].lastIndexOf(self.jobId) + 19),
                        prior: violationStrings[1],
                        pos: violationStrings[2],
                        desc: violationStrings[3],
                        rule: violationStrings[4].slice(0, -1)
                    });
                }

                self.numberIssuesJob = self.numberIssuesJob + (lines.length - 2);
                self.commentJob = 'Number of issues found: ' + self.numberIssuesJob;
                console.log(self.commentJob);
                const bodyBase64 = Buffer.from(content).toString('base64');
                const attachment = await this.connSourceOrg.sobject('Attachment').create({
                    Name: 'ApexPMD result',
                    Description: 'ApexPMD result',
                    ParentId: this.jobId,
                    Body: bodyBase64,
                    ContentType: 'text/plain'
                });
                if (attachment) {
                    console.log("Created record id : " + attachment.id);
                    self.attId = attachment.id;
                }
                const ruleQuery = await self.connSourceOrg.query(`SELECT Id, Name FROM ${NAME_SPACE_PREFIX}Rule__c`);
                for (const record of ruleQuery.records) {
                    self.mapRuls[record.Name] = record.Id;
                }
                console.log("total : " + ruleQuery.totalSize);
                console.log("fetched : " + ruleQuery.records.length);
                console.log('End save results');
                return 'success';
            } else {
                self.isContinue = false;
                console.log('PMD analysis results file not found');
                throw new Error('Result file not found');
            }
        } catch (e) {
            let self = this;
            self.isContinue = false;
            console.log(e.message);
            await self.createErrorLog(e.message);
            throw new Error('Failed to save results');
        }
    }

    async updateObjects() {
        try {
            let self = this;
            let state = 'COMPLETED';
            if (!self.isContinue) {
                const updateTask = await self.connSourceOrg.sobject(`${NAME_SPACE_PREFIX}Flosum_Task__c`).update({
                    Id: self.jobId,
                    [NAME_SPACE_PREFIX + 'Review_Result__c']: self.numberIssuesJob,
                    [NAME_SPACE_PREFIX + 'State__c']: self.stateJob,
                    [NAME_SPACE_PREFIX + 'Comment__c']: self.commentJob
                });
                if (updateTask) {
                    console.log('Updated Flosum_Task Successfully : ' + updateTask.id);
                }
                const updateBranch = await self.connSourceOrg.sobject(`${NAME_SPACE_PREFIX}Branch__c`).update({
                    Id: self.branchId,
                    [NAME_SPACE_PREFIX + 'Review_Result__c']: self.numberIssuesJob,
                    [NAME_SPACE_PREFIX + 'Review_state__c']: 'REVIEWED'
                });
                if (updateBranch) {
                    console.log('Updated Branch Successfully : ' + updateBranch.id);
                }
            } else {
                state = 'IN PROGRESS';
            }

            const reviewResult = await self.connSourceOrg.sobject(`${NAME_SPACE_PREFIX}Review_Result__c`)
                .find({ [NAME_SPACE_PREFIX + 'Review_Job__c']: self.jobId })
                .update({
                    [NAME_SPACE_PREFIX + 'Issues__c']: self.numberIssuesJob,
                    [NAME_SPACE_PREFIX + 'State__c']: state
                });
            if (reviewResult) {
                console.log('Updated Review_Result Successfully : ' + reviewResult[0].id);
            }

            const reviewViolationList = self.violList.map(violation => ({
                [NAME_SPACE_PREFIX + 'File_Name__c']: violation.name,
                [NAME_SPACE_PREFIX + 'Priority__c']: violation.prior,
                [NAME_SPACE_PREFIX + 'Position__c']: violation.pos,
                [NAME_SPACE_PREFIX + 'Rule__c']: self.mapRuls[violation.rule],
                [NAME_SPACE_PREFIX + 'Error_Description__c']: violation.desc,
                [NAME_SPACE_PREFIX + 'Review_Result__c']: reviewResult[0].id
            }));

            if (reviewViolationList.length > 0) {
                await self.connSourceOrg.sobject(`${NAME_SPACE_PREFIX}Review_Violation__c`).create(reviewViolationList, { allowRecursive: true });
                console.log(`Created ${reviewViolationList.length} records.`);
            }

            if (!self.isContinue && self.attId) {
                const finishBody = {
                    methodType: "FINISH_PMD",
                    body: self.attId
                };
                await self.connSourceOrg.apex.post(URL_POST, finishBody);
                console.log('endPost');
            }

            self.violList = [];
            return self.isContinue ? 'continue' : 'success';
        } catch (e) {
            let self = this;
            self.isContinue = false;
            console.log(e.message);
            await self.createErrorLog(e.message);
            throw new Error('Failed to update objects');
        }
    }

    async cleanFolder() {
        try {
            let self = this;
            console.log('delete temp folder: ' + self.jobId);
            fs.rmSync('./' + self.jobId + '/', { recursive: true });
            if (self.subArray.length > 0) {
                console.log('continue');
                self.isContinue = true;
            } else {
                console.log('finish');
                self.isContinue = false;
            }
            console.log('End cleanFolder');
            return 'success';
        } catch (e) {
            let self = this;
            self.isContinue = false;
            console.log('Error getting attachment' + e.message);
            await self.createErrorLog('Error getting attachment' + e.message);
            throw new Error('Failed to clean folder');
        }
    }

    async createErrorLog(error) {
        let self = this;
        try {
            const errorBody = Buffer.from(error.toString()).toString('base64');
            const createAttachment = await self.connSourceOrg.sobject('Attachment').create({
                Name: 'ApexPMD error',
                Description: 'ApexPMD error',
                ParentId: self.jobId,
                Body: errorBody,
                ContentType: 'text/plain'
            });
            if (createAttachment) {
                console.log("Created error attachment id : " + createAttachment.id);
            }

            const updateReviewresult = await self.connSourceOrg.sobject(`${NAME_SPACE_PREFIX}Review_Result__c`)
                .find({ [NAME_SPACE_PREFIX + 'Review_Job__c']: self.jobId })
                .update({
                    [NAME_SPACE_PREFIX + 'Issues__c']: 0,
                    [NAME_SPACE_PREFIX + 'State__c']: 'CANCELED'
                });
            if (updateReviewresult) {
                console.log('Updated Review_Result Successfully : ' + updateReviewresult.id);
            }

            const updateTask = await self.connSourceOrg.sobject(`${NAME_SPACE_PREFIX}Flosum_Task__c`).update({
                Id: this.jobId,
                [NAME_SPACE_PREFIX + 'Review_Result__c']: 0,
                [NAME_SPACE_PREFIX + 'State__c']: 'CANCELED',
                [NAME_SPACE_PREFIX + 'Comment__c']: 'Heroku service error. See Attachment "ApexPMD error" for details.'
            });
            if (updateTask) {
                console.log('Updated Flosum_Task Successfully : ' + updateTask.id);
            }
        } catch (err) {
            console.error('Failed to log error:', err);
        }
    }
}

module.exports = ApexPMD;