/**
 * Add the service methods to meteor
 * =================================
 */
import {Chatpal} from '../base/backend';

Meteor.methods({
	'chatpal.search.search'(text, page, type, filters) {
		try {
			return Chatpal.service.SearchService.search(text, page, type, filters);
		} catch (e) {
			throw new Meteor.Error('chatpal-error', e);
		}
	}
});

Meteor.methods({
	'chatpal.search.stats'() {

		if (!RocketChat.authz.hasAllPermission(Meteor.userId(), 'chatpal-admin')) { throw new Meteor.Error('chatpal-error', 'Access denied'); }

		try {
			return Chatpal.service.SearchService.getStatistics();
		} catch (e) {
			throw new Meteor.Error('chatpal-error', e);
		}
	}
});

Meteor.methods({
	'chatpal.utils.reindex'() {

		if (!RocketChat.authz.hasAllPermission(Meteor.userId(), 'chatpal-admin')) { throw new Meteor.Error('chatpal-error', 'Access denied'); }

		try {
			return Chatpal.service.SearchService.reindex();
		} catch (e) {
			throw new Meteor.Error('chatpal-error', e);
		}
	}
});

Meteor.methods({
	'chatpal.config.set'(config) {

		if (!RocketChat.authz.hasAllPermission(Meteor.userId(), 'chatpal-admin')) { throw new Meteor.Error('chatpal-error', 'Access denied'); }

		//stop all services
		Object.keys(Chatpal.service).forEach((key) => {
			Chatpal.service[key].stop();
		});
		//test settings
		Chatpal.Backend.init(config);

		//make settings
		//check if config already exists
		const settings = RocketChat.models.Settings.findById('CHATPAL_CONFIG').fetch();
		if (settings && settings.length > 0) {
			RocketChat.models.Settings.updateValueById('CHATPAL_CONFIG', config);
		} else {
			RocketChat.models.Settings.createWithIdAndValue('CHATPAL_CONFIG', config);
		}

		if (config.chatpalActivated && !Chatpal.Backend.enabled) { throw new Error('cannot enable chatpal backend'); }
		//start all services

		Object.keys(Chatpal.service).forEach((key) => {
			Chatpal.service[key].start();
		});
	}
});

Meteor.methods({
	'chatpal.config.get'() {

		if (!RocketChat.authz.hasAllPermission(Meteor.userId(), 'chatpal-admin')) { throw new Meteor.Error('chatpal-error', 'Access denied'); }

		const config = RocketChat.models.Settings.findById('CHATPAL_CONFIG').fetch();
		return (config && config.length > 0) ? config[0].value : undefined;
	}
});

Meteor.methods({
	'chatpal.isActive'() {

		const config = RocketChat.models.Settings.findById('CHATPAL_CONFIG').fetch();
		return config && config.length && config[0].value.chatpalActivated;
	}
});

Meteor.methods({
	'chatpal.utils.validatekey'(key) {
		return Chatpal.Backend.validateKey(key);
	}
});

Meteor.methods({
	'chatpal.utils.createkey'(email) {
		return Chatpal.Backend.generateKey(email);
	}
});

Meteor.methods({
	'chatpal.utils.renewkey'(key) {

		if (!RocketChat.authz.hasAllPermission(Meteor.userId(), 'chatpal-admin')) { throw new Meteor.Error('chatpal-error', 'Access denied'); }

		return Chatpal.Backend.renewKey(key);
	}
});

