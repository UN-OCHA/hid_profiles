var operations = require('./lib/operations'),
  bundles = require('./lib/bundles'),
  offices = require('./lib/offices'),
  protectedRoles = require('./lib/protectedRoles'),
  disasters = require('./lib/disasters'),
  async = require('async');

async.auto({
  operations: operations.buildCache,
  bundles: bundles.fetchBundles,
  offices: offices.fetchOffices,
  protectedRoles: protectedRoles.buildCache,
  disasters: disasters.buildCache,
  appData: ['operations', 'bundles', 'offices', 'protectedRoles', 'disasters', operations.buildAppData]
},
function (err, results) {
  console.log("Finished hid_profiles cron run.");
  process.exit();
});
