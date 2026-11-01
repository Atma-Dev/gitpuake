import { reactive } from 'vue'
import { avatar } from './identity.js'
import { settings } from './settings.js'

// Photos GitHub already gave us for recent committers (email -> url). Filled from `gh api`, so no
// email is sent anywhere; Gravatar stays an opt-in on top of this.
export const forgeAvatars = reactive({})

export const photo = email => forgeAvatars[email?.trim().toLowerCase()] || (settings.avatars ? avatar(email) : '')
