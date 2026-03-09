const ApexPMD = require('./ApexPMD');

const express = require('express');
const bodyParser = require("body-parser");
const app = express();
const port = process.env.PORT || 5000;

const appVersion = process.env.npm_package_version;
const pmdVersion = '7.16.0';

app.use(bodyParser.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.on("finish", () => console.log(req.method, decodeURI(req.url), res.statusCode, res.statusMessage));
  next();
})

app.post('/apexPMD', authCheck, (req, res) => {
  console.log('Received request to /apexPMD');
  try {
    const data = req.body;
    const init = new ApexPMD(data.backUrl, data.sId, data.jobId, data.attList, data.attRuls, data.branchId);

    const control = async () => {
      try {
        console.log('Start');

        while (init.isContinue) {
          const getAtt = await init.getAttachment();
          console.log(getAtt);
          const getRul = await init.getRuls();
          console.log(getRul);
          const run = await init.runPMD();
          console.log(run);
          const save = await init.saveResults();
          console.log(save);
          const updt = await init.updateObjects();
          console.log(updt);
          const clean = await init.cleanFolder();
          console.log(clean);
        }
        console.log('PMD process finished');
      } catch (err) {
        console.error('Unhandled error in control:', err);
        await init.cleanFolder();
      }
    };
    control();
    res.send({ isSuccess: true, opStatus: 'INPROGRESS' });
  } catch (error) {
    console.log('Outer error:', error);
    res.status(500).send({ isSuccess: false, message: 'Failed to start PMD analysis' });
  }
});

app.get('/oauth/token', authCheck, (req, res) => {
  let auth;
  if (req.header('x-auth-method') === 'Basic') {
    auth = {
      access_token: 'a54c0200-5f3b-4625-b231111112131213',
      token_type: 'bearer',
      refresh_token: '475b9443-9cef-4468-a4be-e3f449da8d03',
      expires_in: 1867,
      scope: 'read write trust'
    };
  } else if (req.header('x-auth-method') === 'AccessToken') {
    auth = {
      access_token: req.headers.authorization,
      token_type: 'bearer',
      expires_in: 300,
    };
  }
  res.send(auth);
});

app.get('/', (req, res) => {
  res.send(`Ok. Ver:${appVersion}. Ver.PMD: ${pmdVersion}`);
});

function authCheck(req, res, next) {
  if (req.headers.authorization) {
    if (req.header('x-auth-method') === 'Basic' && req.headers.authorization.search('Basic ') === 0) {
      // fetch login and password
      let userEnv = process.env.username;
      let passEnv = process.env.password;
      if (new Buffer.from(req.headers.authorization.split(' ')[1], 'base64').toString() == userEnv + ':' + passEnv) {
        next();
        return;
      }
    } else if (req.header('x-auth-method') === 'AccessToken') {
      next();
      return;
    }
  }
  res.statusCode = 401;
  res.send('not authorization');
}

app.listen(port, () => console.log(`Port: ${port}`));
