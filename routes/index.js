
var versionPrefix = '/v0/';

server.get(versionPrefix + 'profile/view/:uid', accountView);
server.head(versionPrefix + 'profile/view/:uid', accountView);

server.get(versionPrefix + 'profile/save/:uid', accountSave);
server.head(versionPrefix + 'profile/save/:uid', accountSave);

server.get('test', testpage);

server.listen(8080, function() {
  console.log('%s listening at %s', server.name, server.url);
});



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
  // res.send('Beginning the account save process');

  console.log('After database connection, before connection object');
  var db = mongoose.connection;

  var userProfile = new Profile({
    fullname:     req.query.fullname,
    givenname:    req.query.givenname,
    familyname:   req.query.familyname,
    jobtitle:     req.query.jobtitle,
    organization: req.query.organization,
    phone:        req.query.phone,
    email:        req.query.email
  });
  console.log("Created userProfile from model for %s", userProfile.fullname);

  if (true) { // TODO: Make room for validation later

    console.log('All the things will be an upsert for ID %s.', userProfile._id);
    var upsertData = userProfile.toObject();
    delete upsertData._id;
    var userProfileID = (req.params.uid == 0) ? mongoose.Types.ObjectId() : req.params.uid;

    Profile.update({ _id: userProfileID }, upsertData, { upsert: true }, function(err) {
      if (err) console.dir(err);
      console.log('Updated the document for %s.', req.query.fullname);
    });
  }

  res.send('Profile data was saved.');

  next();
}

