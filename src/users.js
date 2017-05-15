'use strict'

/**
 *
 * User info helper.
 *
 * This helper provides following methods:
 *
 *   - getOrFetchUserProfile: given `userId` return a promise of user data (with cache)
 *
 * Data users' profiles will be cached in `${bp.dataLocation}/botpress-messenger.profiles.json`
 *
 */

const Promise = require('bluebird')
const path = require('path')
const fs = require('fs')

module.exports = function(bp, messenger) {

  const filename = path.join(
    bp.dataLocation,
    'botpress-messenger.profiles.json'
    )

  const loadUserProfiles = () => {
    if (fs.existsSync(filename)) {
      return JSON.parse(fs.readFileSync(filename))
    }
    return {}
  }

  const saveUserProfiles = (profiles) => {
    const content = JSON.stringify(profiles)
    fs.writeFileSync(filename, content)
    bp.logger.debug('messenger: saved user profiles to disk')
  }

  const userProfiles = loadUserProfiles()
  let cacheTs = new Date()

  return {
    getOrFetchUserProfile: Promise.method((userId) => {
      if (userProfiles[userId]) {
        return userProfiles[userId]
      }

      return messenger.getUserProfile(userId)
      .then((profile) => {
        profile.id = userId
        userProfiles[userId] = profile
        if (new Date() - cacheTs >= 10000) {
          saveUserProfiles(userProfiles)
          cacheTs = new Date()
        }

        return bp.db.saveUser({
          id: profile.id,
          platform: 'facebook',
          gender: profile.gender,
          timezone: profile.timezone,
          locale: profile.locale,
          picture_url: profile.profile_pic,
          first_name: profile.first_name,
          last_name: profile.last_name
        }).return(profile)

      })
    }),
    getAllUsers: Promise.resolve(userProfiles)
  }
}
