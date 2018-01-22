import {Chatpal} from '../base/backend.js';
import _ from 'underscore';

const Future = Npm.require('fibers/future');
const moment = Npm.require('moment');

let logger;

if (Meteor.isServer) {
	logger = new Logger('ChatpalSearchService', {});
}

class ChatpalIndexer {

	constructor(clear) {
		this.running = true;
		this._messages = RocketChat.models.Messages.model;
		if (clear) {
			this._clear();
		}
		this.bootstrap();
	}

	reindex() {
		if(!this.running) {
			this._clear();
			this.bootstrap();
		}
	}

	static getIndexMessageDocument(m) {
		const doc = {
			id: `m_${ m._id }`,
			room: m.rid,
			user: m.u._id,
			created: m.ts,
			updated: m._updatedAt,
			type: 'CHATPAL_RESULT_TYPE_MESSAGE'
		};

		doc[`text_${ Chatpal.Backend.language }`] = m.msg;

		return doc;
	}

	static getIndexUserDocument(u) {
		return {
			id: `u_${ u._id }`,
			created: u.createdAt,
			updated: u._updatedAt,
			type: 'CHATPAL_RESULT_TYPE_USER',
			user_username: u.username,
			user_name: u.name,
			user_email: _.map(u.emails, (e) => { return e.address; })
		};
	}

	_listMessages(start_date, end_date, start, rows) {
		return this._messages.find({ts:{$gt: new Date(start_date), $lt: new Date(end_date)}, t:{$exists:false}}, {skip:start, limit:rows}).fetch();
	}

	_existsDataOlderThan(date) {
		return this._messages.find({_updatedAt:{$lt: new Date(date)}, t:{$exists:false}}, {limit:1}).fetch().length > 0;
	}

	_clear() {
		logger && logger.debug('Chatpal: Clear Index');

		const options = {data:{
			delete: {
				query: '*:*'
			},
			commit:{}
		}};

		_.extend(options, Chatpal.Backend.httpOptions);

		HTTP.call('POST', Chatpal.Backend.baseurl + Chatpal.Backend.clearpath, options);
	}

	_indexUsers() {

		logger && logger.debug('Chatpal: Index Users');

		const limit = 100;
		let skip = 0;
		const users = [];
		do {
			const users = Meteor.users.find({}, {sort:{createdAt:1}, limit, skip}).fetch();
			skip += limit;

			const userDocs = [];

			users.forEach((u) => {
				userDocs.push(ChatpalIndexer.getIndexUserDocument(u));
			});

			const options = {data:userDocs};

			_.extend(options, Chatpal.Backend.httpOptions);

			const response = HTTP.call('POST', `${ Chatpal.Backend.baseurl }${ Chatpal.Backend.updatepath }`, options);

			logger && logger.debug(`index ${ userDocs.length } users`, Chatpal.Backend.httpOptions, response);

		} while (users.length > 0);
	}

	_index(last_date) {

		logger && logger.debug(`Chatpal: Index ${ new Date(last_date).toISOString() }`);

		const report = {
			start_date: last_date,
			last_date: last_date - Chatpal.Backend.config.batchsize * 3600000,
			number: 0
		};

		let hasNext = true;
		const step = 10;
		const rows = step;
		let start = 0;
		while (hasNext) {
			const messages = this._listMessages(report.last_date, last_date, start, rows);

			const solrDocs = [];

			if (messages.length > 0) {

				messages.forEach(function(m) {
					solrDocs.push(ChatpalIndexer.getIndexMessageDocument(m));
				});

				const options = {data:solrDocs};

				_.extend(options, Chatpal.Backend.httpOptions);

				const response = HTTP.call('POST', `${ Chatpal.Backend.baseurl }${ Chatpal.Backend.updatepath }`, options);

				logger && logger.debug(`index ${ solrDocs.length } messages`, Chatpal.Backend.httpOptions, response);

				report.number += messages.length;

				start += step;
			} else {
				hasNext = false;
			}

		}
		return report;
	}

	stop() {
		this._break = true;
	}

	_run(last_date, fut) {

		this.running = true;

		if (this._existsDataOlderThan(last_date) && !this._break) {
			Meteor.setTimeout(() => {
				this.report = this._index(last_date);

				logger && logger.info(`Indexed ${ this.report.number } messages from ${ new Date(this.report.last_date).toISOString() } to ${ new Date(this.report.start_date).toISOString() }`);

				this._run(this.report.last_date, fut);

			}, Chatpal.Backend.config.timeout);
		} else if (this._break) {
			logger && logger.info('Chatpal: stopped bootstrap');
			this.running = false;
			fut.return();
		} else {

			//index users
			this._indexUsers();

			logger && logger.info('Chatpal: finished bootstrap');

			this.running = false;

			fut.return();
		}
	}

	_getlastdate() {
		const result = HTTP.call('GET', `${ Chatpal.Backend.baseurl }${ Chatpal.Backend.searchpath }?q=*:*&rows=1&sort=created%20asc`, Chatpal.Backend.httpOptions);

		if (result.data.response.numFound > 0) {
			return new Date(result.data.response.docs[0].created).valueOf();
		} else {
			return new Date().valueOf();
		}
	}

	bootstrap() {

		logger && logger.info('Chatpal: bootstrap');

		const fut = new Future();

		const last_date = this._getlastdate();

		this._run(last_date, fut);

		return fut;
	}

}

/**
 * The chatpal search service calls solr and returns result
 * ========================================================
 */
class ChatpalSearchService {

	constructor() {
		this.start();
	}

	start() {
		this.enabled = Chatpal.Backend.enabled;

		logger && logger.info('start search service');

		if (this.enabled) {
			this.indexer = new ChatpalIndexer(Chatpal.Backend.refresh);
		}
	}

	stop() {
		if (this.enabled && this.indexer) {
			this.indexer.stop();
		}
	}

	_getUserData(user_id) {
		const user = RocketChat.models.Users.findById(user_id).fetch();
		if (user && user.length > 0) {
			return {
				name: user[0].name,
				username: user[0].username
			};
		} else {
			return {
				name: 'Unknown',
				username: user_id
			};
		}
	}

	_getSubscription(room_id, user_id) {
		return RocketChat.models.Subscriptions.findOneByRoomIdAndUserId(room_id, user_id);
	}

	_getDateStrings(date) {
		const d = moment(date);
		return {
			date: d.format(Chatpal.Backend.config.dateformat),
			time: d.format(Chatpal.Backend.config.timeformat)
		};
	}

	_getAccessFiler(user) {
		const rooms = RocketChat.models.Subscriptions.find({'u._id': user._id}).fetch();
		return rooms.length > 0 ? `&fq=room:(${ rooms.map(room => room.rid).join(' OR ') })` : '';
	}

	_getGroupAccessFiler(user) {
		const rooms = RocketChat.models.Subscriptions.find({'u._id': user._id}).fetch();
		return rooms.length > 0 ? `&fq=(type:CHATPAL_RESULT_TYPE_USER OR room:(${ rooms.map(room => room.rid).join(' OR ') }))` : '';
	}

	_getQueryParameterStringForMessages(text, page, /*filters*/) {
		const pagesize = Chatpal.Backend.config.docs_per_page;
		return `q=${ encodeURIComponent(text) }&hl.fl=text_${ Chatpal.Backend.language }&fq=type:CHATPAL_RESULT_TYPE_MESSAGE&qf=text_${ Chatpal.Backend.language }^2 text&start=${ (page-1)*pagesize }&rows=${ pagesize }${ this._getAccessFiler(Meteor.user()) }`;
	}

	_getQueryParameterStringForAll(text, /*filters*/) {
		const pagesize = Chatpal.Backend.config.docs_per_page;
		return `q=${ encodeURIComponent(text) }&hl.fl=text_${ Chatpal.Backend.language }&qf=text_${ Chatpal.Backend.language }^2 text&group=true&group.field=type&sort=if(termfreq(type,'CHATPAL_RESULT_TYPE_USER'),2,if(termfreq(type,'CHATPAL_RESULT_TYPE_MESSAGE'),1,0)) desc&group.sort=score desc&group.limit=${ pagesize }${ this._getGroupAccessFiler(Meteor.user()) }`;
	}

	_alignResponse(result) {
		const res = result.response;
		const user = Meteor.user();

		res.docs.forEach((doc) => {
			if (result.highlighting && result.highlighting[doc.id] && result.highlighting[doc.id][`text_${ Chatpal.Backend.language }`]) {
				doc.highlight_text = result.highlighting[doc.id][`text_${ Chatpal.Backend.language }`][0];
			} else {
				doc.highlight_text = doc.text;
			}

			doc.id = doc.id.substring(2);
			doc.user_data = this._getUserData(doc.user);
			doc.date_strings = this._getDateStrings(doc.created);
			doc.subscription = this._getSubscription(doc.room, user._id);

		});

		res.pageSize = Chatpal.Backend.config.docs_per_page;

		return res;
	}

	_alignUserResponse(result) {
		const response = {numFound:result.numFound, docs:[]};

		result.docs.forEach((doc) => {
			response.docs.push(this._getUserData(doc.id.substring(2)));
		});

		return response;
	}

	_alignGroupedResponse(result) {
		const response = {};

		result.grouped.type.groups.forEach((group) => {
			if (group.groupValue === 'CHATPAL_RESULT_TYPE_USER') {
				response.users = this._alignUserResponse(group.doclist);
			}
			if (group.groupValue === 'CHATPAL_RESULT_TYPE_MESSAGE') {
				response.messages = this._alignResponse({
					response:group.doclist,
					highlighting:result.highlighting
				});
			}
		});
		return response;
	}

	_searchAsyncMessages(text, page, filters, callback) {

		const options = {
			content: `${ this._getQueryParameterStringForMessages(text, page, filters) }`
		};

		_.extend(options, Chatpal.Backend.httpOptions);

		logger && logger.debug('query messages:', options);

		HTTP.call('POST', Chatpal.Backend.baseurl + Chatpal.Backend.searchpath, options, (err, data) => {

			if (err) {
				if (err.response.statusCode === 400) {
					callback({status:err.response.statusCode, msg:'CHATPAL_MSG_ERROR_SEARCH_REQUEST_BAD_QUERY'});
				} else {
					callback({status:err.response.statusCode, msg:'CHATPAL_MSG_ERROR_SEARCH_REQUEST_FAILED'});
				}
			} else {
				const result = this._alignResponse(JSON.parse(data.content));

				callback(null, result);
			}

		});
	}

	_searchAsyncAll(text, page, filters, callback) {

		const options = {
			content: `${ this._getQueryParameterStringForAll(text, page, filters) }`
		};

		_.extend(options, Chatpal.Backend.httpOptions);

		logger && logger.debug('query messages:', options);

		HTTP.call('POST', Chatpal.Backend.baseurl + Chatpal.Backend.searchpath, options, (err, data) => {

			if (err) {
				if (err.response.statusCode === 400) {
					callback({status:err.response.statusCode, msg:'CHATPAL_MSG_ERROR_SEARCH_REQUEST_BAD_QUERY'});
				} else {
					callback({status:err.response.statusCode, msg:'CHATPAL_MSG_ERROR_SEARCH_REQUEST_FAILED'});
				}
			} else {
				const result = this._alignGroupedResponse(JSON.parse(data.content));

				callback(null, result);
			}

		});
	}

	index(m) {
		if (this.enabled) {

			const options = {data:ChatpalIndexer.getIndexMessageDocument(m)};

			_.extend(options, Chatpal.Backend.httpOptions);

			HTTP.call('POST', `${ Chatpal.Backend.baseurl }${ Chatpal.Backend.updatepath }`, options);
		}
	}

	indexUser(u) {
		if (this.enabled) {

			const options = {data:ChatpalIndexer.getIndexUserDocument(u)};

			_.extend(options, Chatpal.Backend.httpOptions);

			HTTP.call('POST', `${ Chatpal.Backend.baseurl }${ Chatpal.Backend.updatepath }`, options);
		}
	}

	reindex() {
		if (this.enabled) {
			this.indexer.reindex();
		}
	}

	getStatistics() {
		if (this.enabled) {
			const q = '?q=*:*&rows=0&wt=json&facet=true&facet.range=created&facet=true&facet.range.start=NOW/DAY-1MONTHS&facet.range.end=NOW/DAY&facet.range.gap=%2B1DAYS&facet.field=type';

			const response = HTTP.call('GET', `${ Chatpal.Backend.baseurl }${ Chatpal.Backend.searchpath }${ q }`, Chatpal.Backend.httpOptions);

			const stats = {
				enabled: true,
				numbers: {
					messages: (response.data.facet_counts.facet_fields.type && response.data.facet_counts.facet_fields.type.CHATPAL_RESULT_TYPE_MESSAGE) ? response.data.facet_counts.facet_fields.type.CHATPAL_RESULT_TYPE_MESSAGE : 0,
					users: (response.data.facet_counts.facet_fields.type && response.data.facet_counts.facet_fields.type.CHATPAL_RESULT_TYPE_USER) ? response.data.facet_counts.facet_fields.type.CHATPAL_RESULT_TYPE_USER : 0
				},
				chart: [],
				running: this.indexer.running
			};

			const chart_result = response.data.facet_counts.facet_ranges.created.counts;

			Object.keys(chart_result).forEach(function(date) {
				stats.chart.push([new Date(date),chart_result[date]])
			});

			return stats;
		} else {
			return {enabled:false}
		}
	}

	remove(m) {
		if (this.enabled) {
			logger && logger.debug('Chatpal: Remove Message', m);

			const options = {data:{
				delete: `m_${ m._id }`,
				commit: {}
			}};

			_.extend(options, Chatpal.Backend.httpOptions);

			HTTP.call('POST', Chatpal.Backend.baseurl + Chatpal.Backend.clearpath, options);
		}
	}

	search(text, page, type = 'All', filters) {
		const fut = new Future();

		const bound_callback = Meteor.bindEnvironment(function(err, res) {
			if (err) {
				fut.throw(err);
			} else {
				fut.return(res);
			}
		});

		if (this.enabled) {
			this[`_searchAsync${ type }`](text, page, filters, bound_callback);
		} else {
			bound_callback('backend is currently not enabled');
		}
		return fut.wait();
	}
}

/**
 * Create Service
 * @type {ChatpalSearchService}
 */
Chatpal.service.SearchService = new ChatpalSearchService();

/**
 * Add Hook
 * ========
 */
RocketChat.callbacks.add('afterSaveMessage', function(m) {
	Chatpal.service.SearchService.index(m);
});

RocketChat.callbacks.add('afterDeleteMessage', function(m) {
	Chatpal.service.SearchService.remove(m);
});

RocketChat.callbacks.add('afterCreateUser', function(u){
	console.log(123,u);
	Chatpal.service.SearchService.indexUser(u);
});

RocketChat.callbacks.add('usernameSet', (u) => {
	console.log(234,u);
});
/*
* RocketChat.callbacks.add('afterCreateChannel'/roomTopicChanged/archiveRoom all iun function trackEvent(category, action, label) {
*
*/
