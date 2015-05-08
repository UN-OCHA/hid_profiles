# Humanitarian ID User Profile API

Humanitarian ID provides a self-managed approach to contact lists in humanitarian disasters. The API is a profile field API which uses [restify](http://mcavage.me/node-restify/) and Mongoose. It is only available through access keys which are issued by Humanitarian ID for use by humanitarian agencies and those which support humanitarian work.

## About the H.ID Service

Humanitarian ID (H.ID) allows responders to manage their own contact information both in their "usual" location, and while responding to a crisis. A single "Profile" is used to tie together all "Contact" information for a given person. To create a "Local Contact", a responder will "checkin" to a given crisis. The list of available crises is generated from a list of "operations" on the HumanitarianResponse.info website. The list approximately corresponds to countries, although there are some regions listed which do not have a country code. When a responder is no longer monitoring or responding to a crisis they will "checkout" of the contact list. This disables their local contact listing, but it does not remove it permanently.

An individual may have only a Global Profile and one Global Contact. The Global Contact is not a required part of the setup process. As such, it is possible to have an account and not have a Global Contact. Local Contacts can be created by administrative users. As such, it is possible to have a Local Contact without a Global Profile. After self-registering, and logging into the site, a user is prompted to create a Global Contact. Once this is done, the user is then prompted to create a Local Contact. An individual may "checkin" to as many contact lists as they would like.

Some humanitarian situations are quite sensitive in nature, and revealing responder identities could put them at risk. As a result, H.ID includes the ability to "lock" a contact list. Once locked, only verified responders may view others in the list. All levels of priviledged users may verify an account. This verification process is a simple way for coordinators to say, "Yes, I know this person".

*Editors* - Editors are connected to specific contact lists and may update all fields for all contacts within their list. Editors may not grant permissions to other users. Editors may also create new contacts within their list. When creating a new contact, an Editor will typically include an email address for the contact. This initiates an email invitation to the individual so they may "claim" their account. While waiting for the account to be claimed, this contact is referred to as an *orphan*. If the Editor does not include an email, the account cannot be claimed and is referred to a *ghost*.

*Organization Editors* - Organization Editors are connected to specific contact lists and may only add, or remove organizations from profiles.

*Managers* - Managers are connected to specific contact lists ("operations") and have all the same powers as an Editor. They may also assign the role of Editor to individuals.

*Administrators* - Administrators are granted site-wide permissions and may grant role of Editor or Manager to anyone in the system.

To find out more about the scope, features and benefits of Humanitarian ID, please visit us at [http://humanitarian.id](http://humanitarian.id).

## Using H.ID

To integrate with the profile service for Humanitarian ID, you will need an API key.

### Requesting an API Key

If you are interested in integrating with Humanitarian ID, please contact us (info@humanitarian.id).

To request your API keys, you will need to provide the following information:

- The purpose of your application, and how to relates to humanitarian work.
- Name of site -- displayed to regular user on authorize page, also descriptive for H.ID admins who manage API access
- For web-based applications, the base URL of site -- needed for each environment that will integrate with H.ID, including all production, development, and local environments
- Acknowledgement that you have read the [Code of Conduct](http://humanitarian.id/code-of-conduct), and that your use of this service will comply to the best of your ability with the guidelines in the code. If your site is not able to maintain the standards set out in the H.ID code of conduct, your API key(s) may be revoked.

For example, the HumanitarianResponse.info development server provided the following:

- Purpose of site: Development server for the HR.info site. The production server helps with the coordination of humanitarian relief efforts worldwide. This website is an OCHA-sponsored property.
- Name: HumanitarianResponse.info (dev1)
- Base URL: http://dev1.humanitarianresponse.info/

Based on your application we will review your project, and generate an API key. This process is manual and may take up to a month to verify your account and generate the API keys. To speed up this process, ensure you have provided as much detail as possible in your application.

### Receiving your API Key

Once your application is successful, we will create an API key for you and email you the following details:

- Client key/ID: The "username" of the client site when it uses the authentication service.
- Client secret: The "password" of the client site when it uses the authentication service.

Note: Please don't embed the client secret in the app code. It shouldn't be necessary for a client side app flow. It is included in case you need to make server side calls or for debugging.

## API Access Control

All access to the information stored in Humanitarian ID requires a valid API key. These keyse are issued by H.ID. Further information in "Accessing H.ID with Your Application".

### User Authorization

Pass the Oauth2 access token as a query parameter named "access_token" with all requests. This must be an access token that is valid and not expired. Tokens currently have an 8 hour expiration period.

### Client App Authorization

Provide the client key as a query parameter named `_access_client_id` and generate an access key based on the client secret and request data named `_access_key`.

The access key is generated by concatenating the request parameters in the query (in order alphabetically by key) and the client secret, then applying the SHA-256 hash.

Here is JavaScript code for generating the access key from a "query" object that contains all query parameters:

````
var access_key = SHA256(flattenValues(query) + clientSecret);

function flattenValues(q) {
  var tempList = '';
  for (var key in q) {
    var type = typeof q[key];
    if (type == 'object' || type == 'array') {
      tempList += flattenValues(q[key]);
    }
    else {
      tempList += q[key];
    }
  }
  return tempList;
}
````

If you have not correctly authorized your application, you will receive the message `client or key not accepted` when trying to connect.

## Data Structure

There are two sets of data which are unique to H.ID, and which make connections from outside data sources to individuals: Profiles and Contacts. The outside data sources include HR.info (operations, and their related taxonomies), and ReliefWeb (list of disasters). Profiles are responsible for storing system metadata about the account, including their permissions within H.ID, and the list of Contacts associated with the account. Contacts, on the other hand, are responsible for storing user-generated contact information.

### Profiles

There is a profile record for each user in Humanitarian ID. This profile is effectively the base for all additional contact information which may be added.

The profile is responsible for storing the following information about a user:

Content Type | Type               | Description
-------------|--------------------|--------------------------------
`userid`     | Text string        | unique identifier for this user
`nameFamily` | Text string        | surname for this user
`nameGiven`  | Text string        | preferred or given name
`email`      | Text string        | primary email for this user
`ochaContent`| String             |
`created`    | Number - timestamp | Date of creation for this user
`revised`    | Number - timestamp | Date of last update for this user
`firstUpdate`| Number - timestamp | Date when the first user-generated save was made
`status`     | Boolean            | Active, or archived
`_contacts`  |  [{ type: Schema.Types.ObjectId, ref: 'Contact' }]                  | Contacts which are associated with this user's profile.
`roles`      | String             | One of administrator (site-wide), manager (per crisis, or editor (per crisis)
`orgEditorRoles` | orgEditorRoleSchema | User may add/remove their organization for a given contact list.
`verified`   | Boolean            | Enabled when the person is known within the Humanitarian ID community

### Contacts

Contact records are the bulk of what's displayed in the H.ID app. Contact records may be "Global" (associated with no region), or "Local" (associated with an operation).

The contact is responsible for storing the following information about a user:

Content Type | Type               | Description
-------------|--------------------|--------------------------------
`_profile`   | { type: Schema.Types.ObjectId, ref: 'Profile' } | links to "parent" Profile document (required)
`type`       | String             | Can be one of either "local" or "global"
`location`   | string             |"Liberia - Ebola crisis" or "Global"
`locationId` | String             |
`disasters`  | disasterSchema     | Disasters with a GLIDE number as defined in ReliefWeb.
`nameGiven`  | String             |
`nameFamily` | String             |
`email`      | [ emailSchema ]    |
`phone`      | [ phoneSchema      | Should include the international country prefix for mobile, fax, and landline, and not a local number; however, contacts created via the "orphan" process by an administrator are not currently required to go through this validation process. Satellite phones will not include the international prefix.
`voip`       | [ phoneSchema ]    | Typically Skype, but users may add their own data here.
`address`    | [ addressSchema ]  |
`uri`        | String             | Should be validated to include HTTP or HTTPS.
`organization` | [ organizationSchema ] |
`jobtitle`   |  String            |
`bundle`     | String             | Self-assigned group(s) as defined by the operation on HR.info.
`protectedBundles` | String       | Admin-assigned group(s) as defined by the operation on HR.info.
`notes`      | String             | Open text area.
`created`    | Number - timestamp |
`revised`    | Number - timestamp |
`status`     | Boolean            | Can be set to active or archived.
`keyContact` | Boolean            | Designated a "key contact" for a given cluster. Admin-assigned.
`protectedRoles` | String         | Admin-assigned roles, defined per operation on HR.info.
`image`      | [ imageSchema ]    | Could be a Facebook ID, Google+ ID, or a URL to a hot-linkable image.
`office`     | [ organizationSchema ] | Coordination Hub. Values pulled from operation data on HR.info
`departureDate` | Date            | Date this person is anticipating leaving this region.

## Endpoints

All endpoints require authorized access, and all return JSON data unless otherwise specified.

GET /v0/app/data

- Returns a bundle of app data, including a list of admin roles, protected roles, and active operations with related bundles, offices, and disasters.


GET /v0/profile/view  
POST /v0/profile/view

- Allows fetching the profile and related contacts for a specified user.


POST /v0/profile/delete

- Allows deleting the profile and all related contacts for a specified user.


GET /v0/contact/view  
POST /v0/contact/view

- Allows fetching the contacts (and their related profile) by query parameters.
- Search by any field on a contact, or use the "text" key for a full-text search of several fields, "verified" to include only verified users, "role" to search by admin role of the associated user, "ghost" to include only ghost users, or "orphan" to include only orphan users.
- In addition to JSON, the results may be returned in one of several formats: pdf, csv, or email. To receive the results in an alternate format set the parameter `export` to one of the following:
   - `pdf` -- returns a limited number of fields including: Name, Organization, Title, Location.
   - `csv` -- returns all contact fields
   - `email` -- returns name, and email address as comma separated list. Useful for importing names into mailing lists.

POST /v0/contact/save

- Allows updating a contact (and some fields of the related profile), creating a new contact (and inviting a new user to the system)
- Some actions result in an email being sent
- Access logic is applied so that all users can update their own profiles and privileged users (with admin roles) can update contacts for others, etc.

POST /v0/contact/resetpw

- Allows requesting a password reset or orphan confirmation email is sent

## Examples

This service requires a valid API token to use. Examples in this section have been simplified to remove the token from the URL. Once you have obtained your API token, you may generate an access token using the sample code provided in Client App Authorization.

### Viewing Profile Data

Visit this URL in a browser or via curl to view all documents containing the desired profile fields: http://profiles.humanitarian.id/v0/profile/view

Use parameters to search profile fields. These parameters are case-insensitive and nothing is required (though, at least one parameter must be given, or the request will be ignored).

  * userid=[String] (required, or email is required)
  * nameGiven=[String]
  * nameFamily=[String]
  * jobtitle=[String]
  * organization=[String]
  * phone=[String]
  * email=[String] (required, or userid is required)

### Viewing Contact Data

Visit this URL in a browser or via curl to create or update a profile document: http://profiles.humanitarian.id/v0/contact/view

Use the following parameters to provide the values for each profile field (all values must be URL encoded):

  * userid=[String] (required)
  * nameGiven=[String]
  * nameFamily=[String]
  * jobtitle=[String]
  * organization=[String]
  * phone=[String]
  * email=[String]

The :uid in the path can be either '0' (to indicate a new profile document) or the `_id` of the mongo document for that profile (to update an existing document).

Example URL: `http://profiles.humanitarian.id/v0/profile/save/5418efc931461315485ed408?fullname=Tobby%20D.%20Hagler&givenname=Tobby&familyname=Hagler&jobtitle=Software%20Architect&organization=Phase2&phone=800-555-1212&email=thagler%40phase2technology.com`
