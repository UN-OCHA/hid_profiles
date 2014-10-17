var restify = require('restify');
var server = restify.createServer();
var Logger = require('bunyan');
// var routes = require('./routes');
var config = require('./config');
var models = require('./models');

server.use(restify.queryParser());

var Profile  = models.Profile,
    Contact  = models.Contact,
    mongoose = models.mongoose;

var versionPrefix = '/v0/';

var log = new Logger.createLogger({
  name: 'contactsid-profiles',
  serializers: {
    req: Logger.stdSerializers.req
  }
});
server.log = log;

server.pre(function (request, response, next) {
  request.log.info({req: request}, 'REQUEST');
  next();
});

server.get(versionPrefix + 'profile/view', accountView);
server.post(versionPrefix + 'profile/view', accountView);

server.get(versionPrefix + 'profile/save/:uid', profileSave);
server.post(versionPrefix + 'profile/save/:uid', profileSave);

server.get(versionPrefix + 'contact/save/:uid', contactSave);
server.post(versionPrefix + 'contact/save/:uid', contactSave);

server.get('test', testpage);

server.get(versionPrefix + 'profile/model', accountModel);

server.listen(4000, function() {
  console.log('%s listening at %s', server.name, server.url);
});


function accountModel(req, res, next) {
  var paths = Profile.schema.paths;
  
  delete paths._id;
  delete paths.__v;

  var keys = Object.keys(paths);

  res.send(keys);
  next();
}

function testpage(req, res, next) {
  res.send('hello from the test page');
  next();
}

function valid_security_creds(req) {
  var client_id   = req.query._access_client_id,
      access_key  = req.query._access_key;

  // Step 1: Validate that the client app is allowed
  // @TODO: Pull a list of allowed client IDs from Mongo and get the secret key at the same time
  var allowed_clients = [ '_access_client_id' ];
  if (allowed_clients.indexOf('_access_client_id') == -1) return false;

  var SHA256 = require("crypto-js/sha256");

  delete req.query._access_client_id;
  delete req.query._access_key;

  // @TODO: Get the secret key from Mongo for the requesting client app
  var correct_access_key  = '',
      values_string       = '',
      secret              = 'Kk6a8bk@HZBs'

  for (var key in req.query) {
    values_string += req.query[key];
  }
  values_string += secret;

  correct_access_key = SHA256(values_string);

  // Debug: For comparing hash values
  // console.log("*** The received hash value was: " + access_key);
  // console.log("           I think it should be: " + correct_access_key);

  return (access_key == correct_access_key);
}

function accountView(req, res, next) {
  if (!valid_security_creds(req)) res.send(403, new Error('client or key not accepted'));

  var db = mongoose.connection;
  var docs  = { },
      query = { };

  for (var prop in req.query) {
    // TODO: Do some proper validation about the parameter name and its value
    if (prop == 'userid') {
      query[prop] = req.query[prop];
    }
    else if (prop == '_access_client_id' || prop == _access_key) {
      // do nothing
    }
    else if (req.query.hasOwnProperty(prop)) {
      query[prop] = new RegExp(req.query[prop], "i");
    }
  }

  Profile.find(query, function (err, docs) {
    if (err) console.dir(err);
    console.dir(docs);
    res.send(JSON.stringify(docs));
    next();
  });
}

function profileSave(req, res, next) {
  // if (!valid_security_creds(req)) res.send(403, new Error('client or key not accepted'));
  
  var db = mongoose.connection;


  profileFields = { };

  for (var prop in req.query) {
    profileFields[prop] = req.query[prop];
  }

  console.log("Query fields received and prepped for saving to the Profile document");
  console.dir(profileFields);

  var userProfile = new Profile(profileFields);

  if (true) { // @TODO: Make room for data validation later
    var upsertData = userProfile.toObject();
    delete upsertData._id;

    var userProfileID = req.params.uid;
    if (req.params.uid == 0) {
      userProfileID = req.query.email + '_' + Date.now();
      userProfile.userid = userProfileID;
    }

    Profile.update({ userid: userProfileID }, upsertData, { upsert: true }, function(err) {
      if (err) console.dir(err);
      res.send(JSON.stringify(userProfile));
      next();
    });
  }
}


function contactSave(req, res, next) {
  // if (!valid_security_creds(req)) res.send(403, new Error('client or key not accepted'));
  
  var db = mongoose.connection;

  contactFields = { };

  console.log(" * * * Here come the parameters!");
  console.dir(req.query);
  for (var prop in req.query) {
    contactFields[prop] = req.query[prop];
  }

  console.log("Query fields received and prepped for saving to the Contact document");
  console.dir(contactFields);

  var userContact = new Contact(contactFields);

  if (true) { // @TODO: Make room for data validation later
    var upsertData = userContact.toObject();
    delete upsertData._id;

    var userContactID = (req.params.uid == 0) ? mongoose.Types.ObjectId() : req.params.uid;

    Contact.update({ _id: userContactID }, upsertData, { upsert: true }, function(err) {
      if (err) console.dir(err);
      res.send(JSON.stringify(userContact));
      next();
    });
  }
}
