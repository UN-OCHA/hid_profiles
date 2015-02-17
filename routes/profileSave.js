var Profile = require('../models').Profile;

function post(req, res, next) {
  //TODO: refactor and explore reuse of contactSave
/*
  var profileFields = {};
  for (var prop in req.query) {
    profileFields[prop] = req.query[prop];
  }

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
      res.send(userProfile);
      console.dir(userProfile);
      next();
    });
  }
*/
}

exports.post = post;
