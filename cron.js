var operations = require('./lib/operations'),
  bundles = require('./lib/bundles'),
  protectedRoles = require('./lib/protectedRoles'),
  disasters = require('./lib/disasters'),
  async = require('async');

async.auto({
  operations: operations.buildCache,
  bundles: bundles.fetchBundles,
  protectedRoles: protectedRoles.buildCache,
  disasters: disasters.buildCache,
  appData: ['operations', 'bundles', 'protectedRoles', 'disasters', operations.buildAppData]
},
function (err, results) {
  console.log("Finished hid_profiles cron run.");
  process.exit();
});
