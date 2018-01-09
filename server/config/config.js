/* globals Inject */
Meteor.startup(() => {

	/*
	Meteor.defer(function() {
		if (!RocketChat.models.Users.db.findOneById('chatpal')) {
			RocketChat.models.Users.create({
				_id: 'chatpal',
				name: 'Chatpal',
				username: 'chatpal',
				status: 'online',
				statusDefault: 'online',
				utcOffset: 0,
				active: true,
				type: 'bot'
			});

			RocketChat.authz.addUserRoles('chatpal');

			const rs = RocketChatFile.bufferToStream(new Buffer(Assets.getBinary('server/asset/pal.png')));
			const fileStore = FileUpload.getStore('Avatars');
			fileStore.deleteByName('chatpal');

			const file = {
				userId: 'chatpal',
				type: 'image/png'
			};

			Meteor.runAsUser('chatpal', () => {
				fileStore.insert(file, rs, () => {
					return RocketChat.models.Users.setAvatarOrigin('chatpal', 'local');
				});
			});
		}
	});
	*/
});

Inject.rawBody('chatpal-icons', Assets.getText('server/asset/chatpal-icons.svg'));
