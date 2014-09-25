var restify = require('restify');
var server = restify.createServer();
// var routes = require('./routes');
var config = require('./config');
var models = require('./models');

server.use(restify.queryParser());


var Profile  = models.Profile,
    mongoose = models.mongoose;

var versionPrefix = '/v0/';

server.get(versionPrefix + 'profile/view', accountView);
server.post(versionPrefix + 'profile/view', accountView);

server.get(versionPrefix + 'profile/save/:uid', accountSave);
server.post(versionPrefix + 'profile/save/:uid', accountSave);

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

function accountView(req, res, next) {
  var db = mongoose.connection;
  var docs = { };

  console.log('About to print the test object');

  console.dir(req.query);

  var query = { };
  for (var prop in req.query) {
    // TODO: Do some proper validation about the parameter name and its value
    if (prop == 'userid') {
      query[prop] = req.query[prop];
    }
    else if (req.query.hasOwnProperty(prop)) {
      query[prop] = new RegExp(req.query[prop], "i");
    }
  }

  Profile.find(query, function (err, docs) {
    if (err) console.dir(err);
    console.dir(docs);
    res.send(JSON.stringify(docs));
  });

  next();
}

function accountSave(req, res, next) {
  console.log('After database connection, before connection object');
  var db = mongoose.connection;

  var userProfile = new Profile({
    userid:       req.query.userid,
    fullname:     req.query.fullname,
    givenname:    req.query.givenname,
    familyname:   req.query.familyname,
    jobtitle:     req.query.jobtitle,
    organization: req.query.organization,
    phone:        req.query.phone,
    email:        req.query.email
  });
  console.log("Created userProfile from model for %s", userProfile.fullname);

  if (true) { // TODO: Make room for security/validation later
    console.log('All the things will be an upsert for ID %s.', req.params.userid);
    var upsertData = userProfile.toObject();
    delete upsertData._id;

    var userProfileID = req.params.uid;
    if (req.params.uid == 0) {
      userProfileID = req.query.email + '_' + Date.now();
      userProfile.userid = userProfileID;
    }

    Profile.update({ userid: userProfileID }, upsertData, { upsert: true }, function(err) {
      if (err) console.dir(err);
      console.log('Updated the document for %s.', req.query.fullname);
    });
  }

  res.send(JSON.stringify(userProfile));
  next();
}

