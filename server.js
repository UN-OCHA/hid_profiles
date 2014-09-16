var restify = require('restify');
// var routes = require('./routes');
var config = require('./config');
var models = require('./models');

var Profile  = models.Profile,
    mongoose = models.mongoose;


function testpage(req, res, next) {
  res.send('hello from the test page');
  next();
}

function accountView(req, res, next) {
  Movie.findOne({ fullname: 'Tobby Hagler' }, function(err, Profile) {
    if (err) return console.error(err);
    console.dir(Profile);
  });
  res.send('hello ' + req.params.uid);
  next();
}

function accountSave(req, res, next) {
  res.send('Beginning the account save process');
  console.log("Starting the account save process");

  // console.dir(config);
  console.log('Database connection URL: %s', config.db);


  console.log('After database connection, before connection object');
  var db = mongoose.connection;
  console.log('After database connection object is created');

  // console.dir(db);

  // db.on('error', console.error.bind(console, '*** connection error: '));
  // db.once('open', function callback () {

    console.log('Database connection was successfully opened to %s!', config.db);

    var userProfile = new Profile({
      fullname: 'Tobby Hagler',
      givenname: 'Tobby',
      familyname: 'Hagler',
      title: 'Software Architect',
      organization: 'Phase2',
      phone: '800-555-1212',
      email: 'thagler@phasetechnology.com'
    });
    console.log("Created userProfile from model for %s", userProfile.fullname);
    // console.dir(userProfile);

    userProfile.save(function(err, userProfile) {
      if (err) return console.error.bind(console, '*** Save error: ');
      console.log('save successful!');
      // console.dir(userProfile);
    });

    res.send('hello ' + userProfile.fullname);

  // });

  next();
}

var server = restify.createServer();

var versionPrefix = '/v0/';

server.get(versionPrefix + 'profile/view/:uid', accountView);
server.head(versionPrefix + 'profile/view/:uid', accountView);

server.get(versionPrefix + 'profile/save/:uid', accountSave);
server.head(versionPrefix + 'profile/save/:uid', accountSave);

server.get('test', testpage);

console.log('Created a route at %s', versionPrefix + 'profile/save/:uid');

server.listen(8080, function() {
  console.log('%s listening at %s', server.name, server.url);
});

