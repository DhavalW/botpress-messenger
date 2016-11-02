'use strict';

const EventEmitter = require('eventemitter2');
const crypto = require('crypto');
const fetch = require('node-fetch');

const normalizeString = function(str) {
  return str.replace(/[^a-zA-Z0-9]+/g, '').toUpperCase();
}

class Messenger extends EventEmitter {
  constructor(options) {
    super();
    if (!options 
        || !options.accessToken 
        || !options.verifyToken 
        || !options.appSecret
        || !options.skin) {
      throw new Error('You need to specify an accessToken, verifyToken, appSecret and skin');
    }

    this.accessToken = options.accessToken;
    this.verifyToken = options.verifyToken;
    this.appSecret = options.appSecret;
    this.broadcastEchoes = options.broadcastEchoes || false;

    this.app = options.skin.getRouter('skin-messenger');
    // TODO Verify request is coming from facebook

    this._initWebhook();
  }

  sendTextMessage(recipientId, text, quickReplies, options) {
    const message = { text };
    const formattedQuickReplies = this._formatQuickReplies(quickReplies);
    if (formattedQuickReplies && formattedQuickReplies.length > 0) {
      message.quick_replies = formattedQuickReplies;
    }
    return this.sendMessage(recipientId, message, options);
  }

  sendButtonTemplate(recipientId, text, buttons, options) {
    const payload = {
      template_type: 'button',
      text
    };
    const formattedButtons = this._formatButtons(buttons);
    payload.buttons = formattedButtons;
    return this.sendTemplate(recipientId, payload, options);
  }

  sendGenericTemplate(recipientId, elements, options) {
    const payload = {
      template_type: 'generic',
      elements
    };
    return this.sendTemplate(recipientId, payload, options);
  }

  sendTemplate(recipientId, payload, options) {
    const message = {
      attachment: {
        type: 'template',
        payload
      }
    };
    return this.sendMessage(recipientId, message, options);
  }

  sendAttachment(recipientId, type, url, quickReplies, options) {
    const message = {
      attachment: {
        type,
        payload: { url }
      }
    };
    const formattedQuickReplies = this._formatQuickReplies(quickReplies);
    if (formattedQuickReplies && formattedQuickReplies.length > 0) {
      message.quick_replies = formattedQuickReplies;
    }
    return this.sendMessage(recipientId, message, options);
  }

  sendAction(recipientId, action, options) {
    return this.sendRequest({
      recipient: {
        id: recipientId
      },
      sender_action: action
    });
  }

  sendMessage(recipientId, message, options) {
    const onDelivery = options && options.onDelivery;
    const onRead = options && options.onRead;
    const req = () => (
      this.sendRequest({
        recipient: {
          id: recipientId
        },
        message
      }).then((json) => {
        if (typeof onDelivery === 'function') {
          this.once('delivery', onDelivery);
        }
        if (typeof onRead === 'function') {
          this.once('read', onRead);
        }
        return json;
      })
    );
    if (options && options.typing) {
      const autoTimeout = (message && message.text) ? message.text.length * 10 : 1000;
      const timeout = (typeof options.typing === 'number') ? options.typing : autoTimeout;
      return this.sendTypingIndicator(recipientId, timeout).then(req);
    }

    return req();
  }

  sendRequest(body, endpoint, method) {
    endpoint = endpoint || 'messages';
    method = method || 'POST';
    return fetch(`https://graph.facebook.com/v2.7/me/${endpoint}?access_token=${this.accessToken}`, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    .then(res => {
      // TODO Catch errors here (400+)
      return res.json()}
      )
    .catch(err => console.log(`Error sending message: ${err}`));
  }

  sendThreadRequest(body, method) {
    return this.sendRequest(body, 'thread_settings', method);
  }

  sendTypingIndicator(recipientId, milliseconds) {
    const timeout = isNaN(milliseconds) ? 0 : milliseconds;
    if (milliseconds > 20000) {
      milliseconds = 20000;
      console.error('sendTypingIndicator: max milliseconds value is 20000 (20 seconds)');
    }
    return new Promise((resolve, reject) => {
      return this.sendAction(recipientId, 'typing_on').then(() => {
        setTimeout(() => this.sendAction(recipientId, 'typing_off').then((json) => resolve(json)), timeout);
      });
    });
  }

  getUserProfile(userId) {
    const url = `https://graph.facebook.com/v2.7/${userId}?fields=first_name,last_name,profile_pic,locale,timezone,gender&access_token=${this.accessToken}`;
    return fetch(url)
      .then(res => res.json())
      .catch(err => console.log(`Error getting user profile: ${err}`));
  }

  setGreetingText(text) {
    return this.sendThreadRequest({
      setting_type: 'greeting',
      greeting: { text }
    });
  }

  setGetStartedButton(action) {
    const payload = (typeof action === 'string') ? action : 'BOOTBOT_GET_STARTED';
    if (typeof action === 'function') {
      this.on(`postback:${payload}`, action);
    }
    return this.sendThreadRequest({
      setting_type: 'call_to_actions',
      thread_state: 'new_thread',
      call_to_actions: [ { payload } ]
    });
  }

  deleteGetStartedButton() {
    return this.sendThreadRequest({
      setting_type: 'call_to_actions',
      thread_state: 'new_thread'
    }, 'DELETE');
  }

  setPersistentMenu(buttons) {
    const formattedButtons = this._formatButtons(buttons);
    return this.sendThreadRequest({
      setting_type: 'call_to_actions',
      thread_state: 'existing_thread',
      call_to_actions: formattedButtons
    });
  }

  deletePersistentMenu() {
    return this.sendThreadRequest({
      setting_type: 'call_to_actions',
      thread_state: 'existing_thread'
    }, 'DELETE');
  }

  say(recipientId, message, options) {
    if (typeof message === 'string') {
      return this.sendTextMessage(recipientId, message, [], options);
    } else if (message && message.text) {
      if (message.quickReplies && message.quickReplies.length > 0) {
        return this.sendTextMessage(recipientId, message.text, message.quickReplies, options);
      } else if (message.buttons && message.buttons.length > 0) {
        return this.sendButtonTemplate(recipientId, message.text, message.buttons, options);
      }
    } else if (message && message.attachment) {
      return this.sendAttachment(recipientId, message.attachment, message.url, message.quickReplies, options);
    }
    console.error('Invalid format for .say() message.');
  }

  module(factory) {
    return factory.apply(this, [ this ]);
  }

  

  _formatButtons(buttons) {
    return buttons && buttons.map((button) => {
      if (typeof button === 'string') {
        return {
          type: 'postback',
          title: button,
          payload: 'BOOTBOT_BUTTON_' + normalizeString(button)
        };
      } else if (button && button.title) {
        return button;
      }
      return {};
    });
  }

  _formatQuickReplies(quickReplies) {
    return quickReplies && quickReplies.map((reply) => {
      if (typeof reply === 'string') {
        return {
          content_type: 'text',
          title: reply,
          payload: 'BOOTBOT_QR_' + normalizeString(reply)
        };
      } else if (reply && reply.title) {
        return {
          content_type: reply.content_type || 'text',
          title: reply.title,
          payload: reply.payload || 'BOOTBOT_QR_' + normalizeString(reply.title)
        };
      }
      return {};
    });
  }

  _handleEvent(type, event, data) {
    this.emit(type, event, data);
  }

  _handleMessageEvent(event) {
    if (this._handleConversationResponse('message', event)) { return; }
    const text = event.message.text;
    const senderId = event.sender.id;
    let captured = false;
    if (!text) { return; }

    this._handleEvent('message', event, { captured });
  }

  _handleAttachmentEvent(event) {
    if (this._handleConversationResponse('attachment', event)) { return; }
    this._handleEvent('attachment', event);
  }

  _handlePostbackEvent(event) {
    if (this._handleConversationResponse('postback', event)) { return; }
    const payload = event.postback.payload;
    if (payload) {
      this._handleEvent(`postback:${payload}`, event);
    }
    this._handleEvent('postback', event);
  }

  _handleQuickReplyEvent(event) {
    if (this._handleConversationResponse('quick_reply', event)) { return; }
    const payload = event.message.quick_reply && event.message.quick_reply.payload;
    if (payload) {
      this._handleEvent(`quick_reply:${payload}`, event);
    }
    this._handleEvent('quick_reply', event);
  }

  _handleConversationResponse(type, event) {
    const userId = event.sender.id;
    let captured = false;
    return captured;
  }

  _initWebhook() {
    this.app.get('/webhook', (req, res) => {
      if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === this.verifyToken) {
        console.log('Validation Succeded.')
        res.status(200).send(req.query['hub.challenge']);
      } else {
        console.error('Failed validation. Make sure the validation tokens match.');
        res.sendStatus(403);
      }
    });

    this.app.post('/webhook', (req, res) => {
      var data = req.body;
      if (data.object !== 'page') {
        return;
      }

      // Iterate over each entry. There may be multiple if batched.
      data.entry.forEach((entry) => {
          // Iterate over each messaging event
          entry.messaging.forEach((event) => {
            if (event.message && event.message.is_echo && !this.broadcastEchoes) {
              return;
            }
            if (event.optin) {
              this._handleEvent('authentication', event);
            } else if (event.message && event.message.text) {
              this._handleMessageEvent(event);
              if (event.message.quick_reply) {
                this._handleQuickReplyEvent(event);
              }
            } else if (event.message && event.message.attachments) {
              this._handleAttachmentEvent(event);
            } else if (event.postback) {
              this._handlePostbackEvent(event);
            } else if (event.delivery) {
              this._handleEvent('delivery', event);
            } else if (event.read) {
              this._handleEvent('read', event);
            } else if (event.account_linking) {
              this._handleEvent('account_linking', event);
            } else {
              console.log('Webhook received unknown event: ', event);
            }
          });
        });

        // Must send back a 200 within 20 seconds or the request will time out.
        res.sendStatus(200);
    });
  }

  _verifyRequestSignature(req, res, buf) {
    var signature = req.headers['x-hub-signature'];
    if (!signature) {
      throw new Error('Couldn\'t validate the request signature.');
    } else {
      var elements = signature.split('=');
      var method = elements[0];
      var signatureHash = elements[1];
      var expectedHash = crypto.createHmac('sha1', this.appSecret)
                          .update(buf)
                          .digest('hex');

      if (signatureHash != expectedHash) {
        throw new Error("Couldn't validate the request signature.");
      }
    }
  }
}

module.exports = Messenger;