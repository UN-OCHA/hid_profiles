var _ = require('lodash');
var config = require('./config');
var routes = require('./routes');
var middleware = require('./middleware');
var log = require('./log');

// Set http and https default maxSockets to Infinity to avoid artificial
// constraints in Node < 0.12.
var http = require('http');
http.globalAgent.maxSockets = Infinity;
var https = require('https');
https.globalAgent.maxSockets = Infinity;

var restify = require('restify');
var server = restify.createServer();

server.use(restify.queryParser());
server.log = log;

server.use(restify.bodyParser({
  maxBodySize: 16384,
}));

var helmet = require('helmet');
server.use(helmet.hidePoweredBy());
// Set Strict-Transport-Security header to 4 weeks (in milliseconds)
server.use(helmet.hsts({maxAge: 2419200000, force: config.requireSSL ? true : false}));
server.use(helmet.ieNoOpen());
server.use(helmet.noCache());
server.use(helmet.noSniff());
server.use(helmet.frameguard());
server.use(helmet.xssFilter());

server.use(restify.CORS({
  origins: ['*'],
  credentials: true
}));

server.pre(function (request, response, next) {
  request.log.info({req: request}, 'REQUEST');
  next();
});

var versionPrefix = '/v0/';

server.get(versionPrefix + 'app/data', middleware.require.appOrUser, routes.appData.get);

server.get(versionPrefix + 'list/view', middleware.require.appOrUser, routes.listView.get);

// TODO: Handle access permissions in a later ticket.
server.post(versionPrefix + 'list/save', middleware.require.appOrUser, routes.listSave.postAccess, routes.listSave.post);

server.get(versionPrefix + 'profile/view', middleware.require.appOrUser, routes.profileView.get);
server.post(versionPrefix + 'profile/view', middleware.require.appOrUser, routes.profileView.get);
server.post(versionPrefix + 'profile/delete', middleware.require.appOrUser, routes.profileDelete.postAccess, routes.profileDelete.post);
server.post(versionPrefix + 'profile/save', middleware.require.appOrUser, routes.profileSave.postAccess, routes.profileSave.post);

server.get(versionPrefix + 'contact/view', middleware.require.appOrUser, routes.contactView.get);
server.post(versionPrefix + 'contact/view', middleware.require.appOrUser, routes.contactView.get);
server.post(versionPrefix + 'contact/save', middleware.require.appOrUser, routes.contactSave.postAccess, routes.contactSave.post);
server.post(versionPrefix + 'contact/resetpw', middleware.require.appOrUser, routes.contactSave.postAccess, routes.contactSave.resetPasswordPost);
server.post(versionPrefix + 'contact/notifyContact', middleware.require.appOrUser, routes.contactSave.notifyContact);

// Provide handling for OPTIONS requests for CORS.
server.opts('.*', function(req, res, next) {
  var requestMethod,
    headers = 'X-Requested-With, Cookie, Set-Cookie, Accept, Access-Control-Allow-Credentials, Origin, Content-Type, Request-Id , X-Api-Version, X-Request-Id, Authorization';
  if (req.headers.origin && req.headers['access-control-request-method']) {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', headers);
    res.header('Access-Control-Expose-Headers', 'Set-Cookie');
    requestMethod = req.headers['access-control-request-method'];
    res.header('Allow', requestMethod);
    res.header('Access-Control-Allow-Methods', requestMethod);
    res.send(204);
    return next();
  }
  res.send(404);
  return next();
});

server.listen(process.env.PORT || 4000, function() {
  console.log('%s listening at %s', server.name, server.url);
});
