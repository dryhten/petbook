/*
 * Petbook - social network in react
 *
 * Social network, for pets!
 * */
var express = require("express");
var app = express();
const port = 5000;

const EventEmitter = require("events");
const qs = require("querystring");

const multer = require("multer");
const dropbox = require("dropbox");
let dbx = new dropbox({
    accessToken: process.env.DROPBOX_TOKEN
});

const login = require("my-util/login.js");
const signup = require("my-util/signup.js");
const photos = require("my-util/photos.js");
const posts = require("my-util/posts.js");
const users = require("my-util/users.js");
const friend_requests = require("my-util/friend_requests.js");

app.set("port", (process.env.PORT || port));
app.use(express.static(__dirname + "/public"));

/* temporary solution to store photos - using dropbox */
app.use("/photos", (req, res, next) => {
    dbx.filesDownload({path: req.originalUrl})
	.then(function(response) {
	    res.end(response.fileBinary, "binary");
	})
	.catch(function(error){
	    res.status(404).send("Not found");
	});
});

/* file paths for views */
const index_path = __dirname + "/views/index.html";
const welcome_path = __dirname + "/views/welcome.html";
const user_path = __dirname + "/views/user.html";
const explore_path = __dirname + "/views/explore.html";

/*
 * maximum file size for uploads
 * this is in bytes
 * */
const max_file_size = 2000000;

/* value variables used in several places */
const login_values = ["email_login", "password_login"];
const signup_values = ["first_name_signup", "last_name_signup", "email_signup",
		       "password_signup", "pet_type_signup",
		       "pet_gender_signup", "pet_bday_signup"];

/* start session */
const session = require("express-session");
app.use(session({
    secret: "p3tZ",
    resave: false,
    saveUninitialized: true
}));

/* welcome page */
app.get(["/", "/index", "/index.html"], function(req, res) {
    /* session didn't start, something went wrong */
    if (typeof(req.session) == "undefined"){
	throw new Error("session didn't start");
    }
    /* if user already logged in, show "index.html" */
    if (typeof(req.session["auth"]) != "undefined"){
	res.sendFile(index_path);
	return;
    }
    /* else, show "welcome.html" */
    res.sendFile(welcome_path);
});

app.post(["/", "/index", "/index.html", "/user/:id"], function(req, res){
    /* TODO split this function into multiple smaller ones */

    /* get post data in async/flowing mode */
    let body = "";
    req.on("data", (chunk) => {
	let chunk_str = chunk.toString();
	body += chunk_str;
    });

    let post_data;
    req.on("end", () => {
	post_data = qs.parse(body);

	/* login post */
	if (typeof(post_data["submit_login"]) != "undefined"){
	    /* if user already logged in - ignore */
	    if (typeof(req.session["auth"]) != "undefined"){
		res.redirect("/");
		return;
	    }
	    /* check if post was done correctly */
	    if (!login_values.every(prop => prop in post_data)){
		console.error("incorrect post");
		res.redirect(req.url);
		return;
	    }
	    let login_data = {
		email: post_data["email_login"],
		password: post_data["password_login"]
	    };
	    login.attempt_login(login_data, req);
	    return;
	}
	/* signup post */
	if (typeof(post_data["submit_create_signup"]) != "undefined"){
	    /* if user already logged in - ignore */
	    if (typeof(req.session["auth"]) != "undefined"){
		res.redirect("/");
		return;
	    }
	    /*
	     * check if post was done correctly
	     * post_data must have all the required fields
	     *
	     * first copy the signup_values and remove pet_gender
	     * since it can be absent
	     * */
	    let required_fields = signup_values.slice();
	    const gender_index = required_fields.indexOf("pet_gender_signup");
	    required_fields.splice(gender_index, 1);
	    if (!required_fields.every(prop => prop in post_data)){
		console.error("incorrect post");
		res.redirect(req.url);
		return;
	    }
	    let signup_data = {
		firstName: post_data["first_name_signup"],
		lastName: post_data["last_name_signup"],
		email: post_data["email_signup"],
		password: post_data["password_signup"],
		type: post_data["pet_type_signup"],
		gender: post_data["pet_gender_signup"],
		birthday: post_data["pet_bday_signup"]
	    };
	    signup.attempt_signup(signup_data, req);
	    return;
	}
	/* guest account post TODO */
	if (typeof(post_data["submit_guest_signup"]) != "undefined"){
	    res.send("Guest Account");
	    return;
	}
	/* logout post */
	if (typeof(post_data["submit_logout"]) != "undefined"){
	    req.session.destroy();
	    res.redirect("/");
	    return;
	}
	/* post something on the wall */
	if (typeof(post_data["submit_post"]) != "undefined"){
	    /* if user is not logged in - nothing to submit */
	    if (typeof(req.session["auth"]) == "undefined"){
		res.redirect("/");
		return;
	    }
	    if (!("post_text" in post_data)) {
		console.error("incorrect post");
		res.redirect(req.url);
		return;
	    }
	    /*
	     * if text is empty - nothing to submit
	     * TODO perform this check on the frontend
	     * might save some time
	     * */
	    if (post_data["post_text"] == "") {
		res.redirect(req.url);
		return;
	    }
	    /* add user id to data */
	    post_data["uid"] = req.session.auth["uid"];
	    /* this is a text post */
	    post_data["isText"] = true;
	    post_data["photo"] = null;
	    posts.submit_post(post_data, req, "post_text");
	    return;
	}
	/* delete post */
	if (typeof(post_data["submit_delete_post"]) != "undefined"){
	    /* if user is not logged in - nothing to do */
	    if (typeof(req.session["auth"]) == "undefined"){
		res.redirect("/");
		return;
	    }
	    /* this is like this for future updates */
	    if(!["pid", "isText", "photo_id"].every(
		prop => prop in post_data)){
		console.error("incorrect post");
		res.redirect(req.url);
		return;
	    }
	    /* add uid as well - needed for permission checking */
	    post_data["uid"] = req.session.auth["uid"];
	    /*
	     * for now, if the post is an image, delete the
	     * image as well
	     * "false" is from form (it gets converted)
	     * */
	    if (post_data.isText == "false") {
		photos.delete_photo(post_data, req, "delete_photo");
		return;
	    }
	    posts.delete_post(post_data, req, "post_text");
	    return;
	}
	/* save post after editing */
	if (typeof(post_data["submit_save_post"]) != "undefined"){
	    /* if user is not logged in - nothing to do */
	    if (typeof(req.session["auth"]) == "undefined"){
		res.redirect("/");
		return;
	    }
	    if(!["edit_text", "pid", "isText", "photo_id"].every(
		prop => prop in post_data)){
		console.error("incorrect post");
		res.redirect(req.url);
		return;
	    }
	    /* add uid as well - needed for permission checking */
	    post_data["uid"] = req.session.auth["uid"];
	    /* if it's a photo, description needs to be updated */
	    if (post_data["isText"] == "false") {
		photos.update_photo(post_data, req, "post_image");
		return;
	    }
	    posts.update_post(post_data, req, "post_text");
	    return;
	}
	/* other type of post */
	console.error("invalid post: ", post_data);
	res.redirect(req.url);
    });

    /* after login is done */
    req.once("login", (ret, args) => {
	if (ret["success"] === true){
	    /* move values from ret.session to req.session */
	    req.session.auth = {};
	    Object.assign(req.session.auth, ret.session);

	    /*
	     * get avatar path for auth.avatar id
	     * first register a callback, then wait for it
	     * */
	    req.once("avatar", (ret) => {
		if (ret["success"] == true)
		    req.session.auth["avatarUrl"] = ret["path"];
		res.redirect("/");
	    });
	    photos.get_photo_info(req.session.auth.avatar, req, "avatar");
	    return;
	}

	/* save messages in req.session - flash messages */
	req.session["messages"] = ret["messages"];

	/* save post data for autofill */
	login_values.forEach(function(elem){
	     if (elem in post_data)
		 req.session[elem] = post_data[elem];
	});

	/* switch from post to get */
	res.redirect(req.url);
	return;
    });
    /* after signup is done */
    req.once("signup", (ret, args) => {
	if (ret["success"] === true){
	    /*
	     * log the user in and redirect
	     * this will add avatarUrl by default
	     * */
	    req.session.auth = {};
	    Object.assign(req.session.auth, ret.session);
	    res.redirect("/");
	    return;
	}

	/* save messages in req.session - flash messages */
	req.session["messages"] = ret["messages"];

	/*
	 * save post data for autofill
	 * save only signup_values, there might be a lot of trash
	 * in the post data to consume memory
	 * */
	signup_values.forEach(function(elem){
	     if (elem in post_data)
		 req.session[elem] = post_data[elem];
	 });

	/* switch from post to get */
	res.redirect(req.url);
	return;
    });
    /*
     * after posting something new
     * after deleting/updating post
     * */
    req.once("post_text", (ret, args) => {
	/*
	 * TODO maybe display errors to users if anything?
	 * if (ret["success"] === true)
	 * */
	res.redirect(req.url);
    });
    req.once("post_image", (ret, args) => {
	/* maybe not update timestamp? */
	post_data["edit_text"] = "";
	posts.update_post(post_data, req, "post_text");
    });
    req.once("delete_photo", (ret, args) => {
	/* if deleted photo was user avatar, change to default */
	if (post_data.photo_id == req.session.auth.avatar) {
	    req.session.auth.avatar = photos.default_avatar_id;
	    req.session.auth.avatarUrl = photos.default_avatar_path;
	    let data = {
		uid: req.session.auth.uid,
		photo_id: photos.default_avatar_id
	    };
	    users.update_avatar(data, req, "default_avatar");
	} else {
	    req.emit("default_avatar");
	}
    });
    req.once("default_avatar", (ret) => {
	posts.delete_post(post_data, req, "post_text");
    });
});

/* multer object for uploading photos */
const my_storage = multer.memoryStorage();
const upload_photo = multer({
    /*
     * specifying "dest" will use DiskStorage
     * I guess this saves the file to the disk before the post handler
     *
     * while "storage" will use MemoryStorage
     * in post handler, req.buffer will be the file data
     *
     * for now don't save file to disk and upload buffer to
     * dropbox
     */
    //dest: "public/photos/",
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
	/*
	 * this is to block non-users from uploading
	 * also, the post function will run even if the file
	 * was not uploaded, so this needs to be checked twice
	 * */
	if (typeof(req.session["auth"]) == "undefined"){
	    cb(null, false);
	    return;
	}
	/*
	 * TODO this is not guaranteed to work every time
	 * a working solution would be to check on the frontend
	 * if field is empty and if so, stop there
	 *
	 * since we can have custom post requests (e.g. curl)
	 * we need to check in main function anyway, and delete
	 * the uploaded photo from disk if field is empty
	 * */
	if (!("post_pic_desc" in req.body) ||
	    (req.body["post_pic_desc"] == "")) {
	    cb(new Error("Pictures without description are not allowed"));
	    return;
	}
	const tokens = file.originalname.split(".");
	const extension = tokens[tokens.length - 1];
	const allowed_extensions = ["png", "jpg", "jpeg"];
	if (allowed_extensions.indexOf(extension) < 0) {
	    /*
	     * TODO how to pass message to cb
	     * this will show in the generic error handler
	     * cb(new Error("File type not accepted"));
	     * */
	    cb(new Error("File type not accepted"));
	    //cb(null, false);
	    return;
	}
	cb(null, true);
    },
    limits: {
	fileSize: max_file_size
    }
});

app.post("/upload-post", upload_photo.single("file_upload"), (req, res) => {
    /*
     * this is for uploading photos on the wall/using the post
     * several node.js modules for dealing with uploaded files
     *
     * multer
     * https://www.npmjs.com/package/multer
     * multiparty
     * https://www.npmjs.com/package/multiparty
     * busyboy
     * https://www.npmjs.com/package/busboy
     * formidable
     * https://www.npmjs.com/package/formidable
     *
     * TODO an error during upload will throw and it will be displayed
     * using the generic error handler; I should prob check file sizes
     * and types on frontend before sending the file and I should display
     * a nice message instead (or maybe use flash messages as well)
     *
     * if fileFilter rejects file nothing will be displayed
     * if it throws then the ugly message will show
     *
     * I guess flash messages won't be too hard to implement
     * do something similar to welcome page and just set them
     * whenever there's an error (in mainstore); they get deleted
     * after one use anyway
     * */

    /* if user is not logged in - nothing to submit */
    if (typeof(req.session["auth"]) == "undefined"){
	res.redirect("/");
	return;
    }
    /*
     * TODO delete photos without description here
     * !("post_pic_desc" in req.body) ... like above
     *
     * or just use "storage" instead of "dest" and check body
     * here; if it's empty - don't save file
     * */

    let photo_id, dst_fname;
    /* after photo has been uploaded to dropbox */
    req.once("dropbox", (ret) => {
	if (ret["success"] === false) {
	    res.redirect("/");
	    return;
	}
	/* add photo to db */
	let photo_data = {
	    path: dst_fname,
	    owner: req.session.auth.uid,
	    mimetype: req.file.mimetype,
	    description: req.body["post_pic_desc"],
	    size: req.file.size
	};
	photos.submit_photo(photo_data, req, "photo");
    });
    /* after photo has been added to db */
    req.once("photo", (ret) => {
	if (ret["success"] === false) {
	    res.redirect("/");
	    return;
	}
	photo_id = ret.photo_id;
	/* add post to db */
	let post_data = {
	    uid: req.session.auth.uid,
	    isText: false,
	    post_text: "",
	    photo: ret.photo_id
	};
	posts.submit_post(post_data, req, "post");
    });
    req.once("post", (ret) => {
	if (req.body.set_profile_picture == "on") {
	    let data = {
		uid: req.session.auth.uid,
		photo_id: photo_id
	    };
	    users.update_avatar(data, req, "avatar");
	    return;
	}
	res.redirect("/");
    });
    req.once("avatar", (ret) => {
	req.session.auth.avatar = photo_id;
	req.session.auth.avatarUrl = dst_fname;
	res.redirect("/");
    });

    /* first upload file to dropbox */
    dst_fname = "/photos/" + req.file.fieldname + "_" + Date.now();
    dbx.filesUpload({path: dst_fname, contents: req.file.buffer})
	.then(function (response) {
	    req.emit("dropbox", {success: true});
	})
	.catch(function (err) {
	    req.emit("dropbox", {success: false});
	});
});

/* user page */
app.get("/user/:id", function(req, res){
    /* session didn't start, something went wrong */
    if (typeof(req.session) == "undefined"){
	throw new Error("session didn't start");
    }
    /* if user is not logged in, redirect to "/" */
    if (typeof(req.session["auth"]) == "undefined"){
	res.redirect("/");
	return;
    }
    req.once("last_user", (ret) => {
	if (ret.success === false) {
	    /*
	     * TODO maybe something nicer
	     * something like "Current page is unavailable"
	     * or "User not found" with style etc
	     * */
	    res.send(ret.messages);
	}
	res.sendFile(user_path);
    });
    store_last_user(req, "last_user", req);
});

function store_last_user(ee, event, req) {
    /* TODO decide where to place this */
    /* get user info */
    let friends, num_updated = 0;
    const store_emitter = new EventEmitter();
    /* after we have friends info */
    store_emitter.on("friends", (ret) => {
	/*
	 * again, nothing to do on errors and nothing to
	 * update here, we passed friends list by reference,
	 * so we just need to return auth
	 * */
	ee.emit(event, {success: true});
    });
    /* after we have avatar path */
    store_emitter.once("avatar", (ret) => {
	/* nothing to do on error */
	req.session.last_user.avatarUrl = ret.path;
	if (req.session.last_user.friends.length == 0) {
	    ee.emit(event, {success: true});
	    return;
	}
	/* get friends info */
	update_user_list(req.session.last_user.friends,
			 store_emitter, "friends");
    });
    /* after we have user info */
    store_emitter.once("user", (ret) => {
	if (ret.success === false) {
	    let ret = {
		success: false,
		messages: ["User doesn't exist"]
	    };
	    ee.emit(event, ret);
	    return;
	}
	/* save everything in session to be accessible in /api/user */
	req.session.last_user = {
	    uid: ret.uid,
	    firstName: ret.firstName,
	    lastName: ret.lastName,
	    email: ret.email,
	    type: ret.type,
	    gender: ret.gender,
	    birthday: ret.birthday,
	    friends: ret.friends
	};
	/* get avatar path */
	photos.get_photo_info(ret.avatar, store_emitter, "avatar");
    });
    /* get user info */
    users.get_user_info(req.params.id, store_emitter, "user");
}

app.post("/add-friend", function(req, res){
    /* add a new friend request for user */
    if (typeof(req.session.auth) == "undefined"){
	res.send({success: false});
	return;
    }
    /* get post data */
    let body = "";
    req.on("data", (chunk) => {
	let chunk_str = chunk.toString();
	body += chunk_str;
    });
    let post_data;
    req.on("end", () => {
	post_data = qs.parse(body);
	/* check if post was done correctly */
	if (!["to", "from"].every(prop => prop in post_data)){
	    console.error("incorrect post: bad fields in post_data");
	    res.send({success: false});
	    return;
	}
	/* "from" should be the currently logged in user */
	if (post_data["from"] != req.session.auth.uid) {
	    console.error("incorrect post: bad 'from' user in post_data");
	    res.send({success: false});
	    return;
	}
	friend_requests.add_request(post_data, req, "friend_request");
    });
    req.once("friend_request", (ret, args) => {
	res.send(ret);
    });
});

app.post("/accept-friend", function(req, res){
    /* accept friend request for user */
    if (typeof(req.session.auth) == "undefined"){
	res.send({success: false});
	return;
    }
    /* get post data */
    let body = "";
    req.on("data", (chunk) => {
	let chunk_str = chunk.toString();
	body += chunk_str;
    });
    let post_data;
    req.on("end", () => {
	post_data = qs.parse(body);
	/* check if post was done correctly */
	if (!["to", "from"].every(prop => prop in post_data)){
	    console.error("incorrect post: bad fields in post_data");
	    res.send({success: false});
	    return;
	}
	/* "to" should be the currently logged in user */
	if (post_data["to"] != req.session.auth.uid) {
	    console.error("incorrect post: bad 'to' user in post_data");
	    res.send({success: false});
	    return;
	}
	/* I think this is still needed for friends lists */
	if (post_data["to"] == post_data["from"]) {
	    console.error("incorrect post: 'to' and 'from' are same users");
	    res.send({success: false});
	    return;
	}
	friend_requests.accept_request(post_data, req, "friend_request");
    });
    req.once("friend_request", (ret, args) => {
	if (ret.success === false) {
	    res.send(ret);
	    return;
	}
	users.add_friend(post_data.to, post_data.from, req, "friend1");
    });
    req.once("friend1", (ret, args) => {
	if (ret.success === false) {
	    res.send(ret);
	    return;
	}
	users.add_friend(post_data.from, post_data.to, req, "friend2");
    });
    req.once("friend2", (ret, args) => {
	res.send(ret);
    });
});

app.post("/reject-friend", function(req, res){
    /* reject friend request for user */
    if (typeof(req.session.auth) == "undefined"){
	res.send({success: false});
	return;
    }
    /* get post data */
    let body = "";
    req.on("data", (chunk) => {
	let chunk_str = chunk.toString();
	body += chunk_str;
    });
    let post_data;
    req.on("end", () => {
	post_data = qs.parse(body);
	/* check if post was done correctly */
	if (!["to", "from"].every(prop => prop in post_data)){
	    console.error("incorrect post: bad fields in post_data");
	    res.send({success: false});
	    return;
	}
	/* "to" should be the currently logged in user */
	if (post_data["to"] != req.session.auth.uid) {
	    console.error("incorrect post: bad 'to' user in post_data");
	    res.send({success: false});
	    return;
	}
	/*
	 * normally there won't be any friend requests in the db with
	 * the same "from" and "to", but I guess it's a little faster
	 * if we check here
	 * */
	if (post_data["to"] == post_data["from"]) {
	    console.error("incorrect post: 'to' and 'from' are same users");
	    res.send({success: false});
	    return;
	}
	friend_requests.reject_request(post_data, req, "friend_request");
    });
    req.once("friend_request", (ret, args) => {
	res.send(ret);
    });
});

app.post("/unfriend", function(req, res){
    /* unfriends 2 users */
    if (typeof(req.session.auth) == "undefined"){
	res.send({success: false});
	return;
    }
    /* get post data */
    let body = "";
    req.on("data", (chunk) => {
	let chunk_str = chunk.toString();
	body += chunk_str;
    });
    let post_data;
    req.on("end", () => {
	post_data = qs.parse(body);
	/* check if post was done correctly */
	if (!["to", "from"].every(prop => prop in post_data)){
	    console.error("incorrect post: bad fields in post_data");
	    res.send({success: false});
	    return;
	}
	/* "from" should be the currently logged in user */
	if (post_data["from"] != req.session.auth.uid) {
	    console.error("incorrect post: bad 'from' user in post_data");
	    res.send({success: false});
	    return;
	}
	users.unfriend(post_data.from, post_data.to, req, "unfriend1");
    });
    req.once("unfriend1", (ret, args) => {
	if (ret.success === false) {
	    res.send(ret);
	    return;
	}
	users.unfriend(post_data.to, post_data.from, req, "unfriend2");
    });
    req.once("unfriend2", (ret, args) => {
	res.send(ret);
    });
});

/* explore page */
app.get("/explore", function(req, res) {
    /* session didn't start, something went wrong */
    if (typeof(req.session) == "undefined"){
	throw new Error("session didn't start");
    }
    /* if user is not logged in, redirect to "/" */
    if (typeof(req.session["auth"]) == "undefined"){
	res.redirect("/");
	return;
    }
    /* else, show "explore.html" */
    res.sendFile(explore_path);
});

/*
 * TODO - maybe move all /api/ routes to a different file?
 * then mount it on /api/ and make all routes shorter
 * */
app.get("/api/messages", function(req, res){
    /* flash messages - taken from session variable */
    let messages = [];
    if (typeof(req.session["messages"]) != "undefined"){
	req.session.messages.forEach(function(message){
	    messages.push(message);
	});
	/* clear for refresh/future requests */
	delete req.session.messages;
    }
    res.send(messages);
});

app.get("/api/values", function(req, res){
    /* saving typed data on forms */
    let values = {};
    let values_list = login_values.concat(signup_values);
    values_list.forEach(function(value){
	if (value in req.session){
	    values[value] = req.session[value];
	    /* you might want to keep typed data on refresh */
	    delete req.session[value];
	}
    });
    res.send(values);
});

app.get("/api/auth", function(req, res){
    /* auth details - from session variable */
    res.send(req.session.auth);
});

app.get("/api/update-auth", function(req, res){
    /*
     * update auth data and returns it
     * this is needed for update friends list
     * maybe move friends list somewhere else?
     *
     * TODO right now avatar doesn't get updated
     * */
    req.once("user_info", (ret) => {
	if (ret.success === false) {
	    res.send(req.session.auth);
	    return;
	}
	/*
	 * we need this because we don't use everything that's
	 * returned by get_user_info()
	 *
	 * TODO update avatar/avatarUrl as well
	 * */
	let updated_data = {
	    uid: ret.uid,
	    firstName: ret.firstName,
	    lastName: ret.lastName,
	    email: ret.email,
	    type: ret.type,
	    gender: ret.gender,
	    birthday: ret.birthday,
	    friends: ret.friends
	};
	Object.assign(req.session.auth, updated_data);
	res.send(req.session.auth);
    });
    users.get_user_info(req.session.auth.uid, req, "user_info");
});

app.get("/api/posts", function(req, res){
    /*
     * list of posts to be displayed for user currently logged in
     * user logged in: req.session.auth.uid
     *
     * this should be a list of all the posts made by the user
     * or her/his friends, sorted after timestamp (TODO)
     *
     * do something like /api/friends -> uids -> get_posts(uids)
     * */
    if (typeof(req.session["auth"]) == "undefined"){
	res.send([]);
	return;
    }
    req.once("posts", (ret) => {
	res.send(ret.posts);
    });
    get_posts(req.session.auth.uid, req, "posts");
});

app.get("/api/posts/:uid", function(req, res){
    /* gets posts for uid */
    if (typeof(req.session["auth"]) == "undefined"){
	res.send([]);
	return;
    }
    req.once("posts", (ret) => {
	res.send(ret.posts);
    });
    get_posts(req.params.uid, req, "posts");
});

function get_posts(uid, ee, event) {
    /*
     * function that returns all the posts for uid
     *
     * TODO decide where to place this
     * */
    const posts_emitter = new EventEmitter();
    /* when we have posts from db */
    posts_emitter.once("posts", (ret, args) => {
	/* on failure, ret.posts should be [] */
	if (ret.posts.length == 0) {
	    ee.emit(event, {posts: []});
	    return;
	}
	/*
	 * we need avatar and user info for each post
	 * req is used as event emitter for both
	 * ret will be in scope both times and I just modified
	 * this variable as a first solution
	 *
	 * when we have avatarUrls -> "avatarLoopFinish"
	 * when we have user info -> "userLoopFinish"
	 *
	 * for now posts will be sent in reversed order
	 * later: sort after timestamp
	 *
	 * also, should this (sorting) be performed on the frontend?
	 * */
	posts_emitter.on("userLoopFinish", () => {
	    get_avatar_info();
	});
	posts_emitter.on("avatarLoopFinish", () => {
	    get_photo_info();
	});
	posts_emitter.on("photoLoopFinish", () => {
	    /* sort posts after timestamp */
	    ret.posts.sort(function(a, b) {
		return new Date(b.timestamp).getTime() -
		    new Date(a.timestamp).getTime();
	    });
	    ee.emit(event, {posts: ret.posts});
	});
	get_user_info();

	/* if post is picture, add picture path and description */
	function get_photo_info() {
	    /* count how many photos */
	    let num_photos = 0, num_updated = 0;
	    for (let i = 0; i < ret.posts.length; i++) {
		if (ret.posts[i].isText === false)
		    num_photos++;
	    }
	    if (num_photos === 0)
		posts_emitter.emit("photoLoopFinish");

	    posts_emitter.on("photoLoopElem", (result) => {
		if (result.success === false) {
		    /* ignore for now */
		    return;
		}
		let index = result.args.index;
		ret.posts[index]["photoUrl"] = result["path"];
		ret.posts[index]["text"] = result["description"];
		num_updated++;
		if (num_updated == num_photos) {
		    posts_emitter.emit("photoLoopFinish");
		}
	    });
	    for (let i = 0; i < ret.posts.length; i++) {
		if (ret.posts[i].isText === false) {
		    photos.get_photo_info(ret.posts[i].photo,
					  posts_emitter, "photoLoopElem",
					  {index: i});
		}
	    }
	}
	/* add avatarUrl to posts */
	function get_avatar_info() {
	    let j = 0;
	    /* when avatarUrl is retrived for one element */
	    posts_emitter.on("avatarLoopElem", (result) => {
		if (result.success === false) {
		    /* ignore for now */
		    return;
		}
		ret.posts[j++]["avatarUrl"] = result["path"];
		if (j == ret.posts.length)
		    posts_emitter.emit("avatarLoopFinish");
	    });
	    for (let i = 0; i < ret.posts.length; i++) {
		photos.get_photo_info(ret.posts[i].avatar,
				      posts_emitter, "avatarLoopElem");
	    }
	}
	/* add firstName and lastName to posts */
	function get_user_info() {
	    let j = 0;
	    /* when user info is retrived for one element */
	    posts_emitter.on("userLoopElem", (result) => {
		if (result.success === false) {
		    /* ignore for now */
		    return;
		}
		ret.posts[j]["firstName"] = result["firstName"];
		ret.posts[j]["lastName"] = result["lastName"];
		ret.posts[j]["avatar"] = result["avatar"];
		j++;
		if (j == ret.posts.length)
		    posts_emitter.emit("userLoopFinish");
	    });
	    for (let i = 0; i < ret.posts.length; i++) {
		users.get_user_info(ret.posts[i].uid, posts_emitter,
				    "userLoopElem");
	    }
	}
    });
    /* get posts from db */
    posts.get_posts(uid, posts_emitter, "posts");
}

app.get("/api/user/:id", function(req, res){
    if (typeof(req.session) == "undefined"){
	res.redirect("/");
	return;
    }
    if (typeof(req.session["auth"]) == "undefined"){
	res.redirect("/");
	return;
    }
    req.once("last_user", (ret) => {
	res.send(req.session["last_user"]);
    });
    if (typeof(req.session["last_user"]) == "undefined"){
	store_last_user(req, "last_user", req);
    } else {
	req.emit("last_user", {success: true});
    }
});

app.get("/api/users", function(req, res){
    /* gets info on all users (e.g. when exploring) */
    if (typeof(req.session) == "undefined"){
	res.redirect("/");
	return;
    }
    if (typeof(req.session["auth"]) == "undefined"){
	res.redirect("/");
	return;
    }

    let user_lst = [], num_updated = 0;
    const users_emitter = new EventEmitter();
    users_emitter.on("avatarLoopFinish", () => {
	/* TODO sort after registration time? */
	res.send(user_lst);
    });
    users_emitter.on("avatarLoopElem", (result) => {
	if (result.success === false) {
	    /* ignore for now */
	    return;
	}
	let index = result.args.index;
	user_lst[index]["avatarUrl"] = result["path"];
	num_updated++;
	if (num_updated == user_lst.length) {
	    users_emitter.emit("avatarLoopFinish");
	}
    });
    users_emitter.on("users", (ret) => {
	/*
	 * TODO decide what to keep here
	 * e.g. don't return hashed password
	 * */
	ret.users.forEach(function(elem){
	    user_lst.push({
		id: elem.id,
		firstName: elem.firstName,
		lastName: elem.lastName,
		email: elem.email,
		type: elem.type,
		gender: elem.gender,
		birthday: elem.birthday,
		friends: elem.friends,
		avatar: elem.avatar
	    });
	});
	/* add avatarUrl */
	for (let i = 0; i < user_lst.length; i++) {
	    photos.get_photo_info(user_lst[i].avatar, users_emitter,
				  "avatarLoopElem", {index: i});
	}
    });
    users.get_users(users_emitter, "users");
});

app.get("/api/friend-requests", function(req, res){
    /*
     * list of friend requests for user currently logged in
     * user logged in: req.session.auth.uid
     *
     * this also adds firstName, avatar etc to received requests
     * so they can be displayed
     * TODO refactor this code
     * */
    if (typeof(req.session["auth"]) == "undefined"){
	res.send([]);
	return;
    }

    let num_req_received = 0, num_updated = 0, requests = [];
    const req_emitter = new EventEmitter();
    req_emitter.on("avatarLoopFinish", (result) => {
	res.send(requests);
    });
    req_emitter.on("avatarLoopElem", (result) => {
	num_updated++;
	if (result.success === false) {
	    if (num_updated == num_req_received)
		req_emitter.emit("avatarLoopFinish");
	    return;
	}
	let index = result.args.index;
	requests[index].from.avatarUrl = result.path;
	if (num_updated == num_req_received) {
	    req_emitter.emit("avatarLoopFinish");
	}
    });
    req_emitter.on("userLoopFinish", () => {
	num_updated = 0;
	for (let i = 0; i < requests.length; i++) {
	    if (requests[i].to.id == req.session.auth.uid) {
		photos.get_photo_info(requests[i].from.avatar, req_emitter,
				      "avatarLoopElem", {index: i});
	    }
	}
    });
    req_emitter.on("userLoopElem", (result) => {
	num_updated++;
	if (result.success === false) {
	    if (num_updated == num_req_received)
		req_emitter.emit("userLoopFinish");
	    return;
	}
	let index = result.args.index;
	requests[index].from.firstName = result.firstName;
	requests[index].from.lastName = result.lastName;
	requests[index].from.avatar = result.avatar;
	if (num_updated == num_req_received) {
	    req_emitter.emit("userLoopFinish");
	}
    });
    req_emitter.once("friend_requests", (ret) => {
	if (ret.success === false) {
	    res.send([]);
	    return;
	}
	if (ret.requests.length == 0) {
	    res.send([]);
	    return;
	}
	requests = ret.requests;
	for (let i = 0; i < requests.length; i++) {
	    /* get info only on requests I received */
	    if (requests[i].to.id == req.session.auth.uid) {
		num_req_received++;
		users.get_user_info(requests[i].from.id,
				    req_emitter, "userLoopElem", {index: i});
	    }
	}
	if (num_req_received == 0) {
	    res.send(requests);
	}
    });
    friend_requests.get_requests(req.session.auth.uid,
				 req_emitter, "friend_requests");
});

app.get("/api/friends", function(req, res){
    /*
     * updates list of friends for currently logged in user
     * with firstName, lastName, avatar etc
     * this is in: req.session.auth.friends
     *
     * to avoid another call to /api/auth this also returns
     * req.session.auth
     * */
    if (typeof(req.session.auth) == "undefined"){
	res.send({});
	return;
    }
    let friends_emitter = new EventEmitter();
    friends_emitter.on("friends", (result) => {
	/*
	 * nothing to update here, we passed friends list
	 * by reference, so we just need to return auth
	 * */
	res.send(req.session.auth);
    });
    update_user_list(req.session.auth.friends, friends_emitter, "friends");
});

function update_user_list(friends, ee, event) {
    /*
     * Function that updates a list of users (uids)
     * with the following info:
     *   firstName, lastName, avatar, avatarUrl
     *
     * Updated list will be in result.friends
     *
     * TODO make this function to accept custom params to
     * update
     * */
    let num_updated = 0;
    if (friends.length == 0) {
	ee.emit(event, {success: true, friends: friends});
    }

    let friends_emitter = new EventEmitter();
    friends_emitter.on("avatarLoopFinish", (result) => {
	ee.emit(event, {success: true, friends: friends});
    });
    friends_emitter.on("avatarLoopElem", (result) => {
	num_updated++;
	if (result.success === false) {
	    if (num_updated == friends.length)
		friends_emitter.emit("avatarLoopFinish");
	    return;
	}
	let index = result.args.index;
	friends[index].avatarUrl = result.path;
	if (num_updated == friends.length) {
	    friends_emitter.emit("avatarLoopFinish");
	}
    });
    friends_emitter.on("userLoopFinish", () => {
	num_updated = 0;
	for (let i = 0; i < friends.length; i++) {
	    photos.get_photo_info(friends[i].avatar, friends_emitter,
				  "avatarLoopElem", {index: i});
	}
    });
    friends_emitter.on("userLoopElem", (result) => {
	num_updated++;
	if (result.success === false) {
	    if (num_updated == friends.length)
		friends_emitter.emit("userLoopFinish");
	    return;
	}
	let index = result.args.index;
	friends[index].firstName = result.firstName;
	friends[index].lastName = result.lastName;
	friends[index].avatar = result.avatar;
	if (num_updated == friends.length)
	    friends_emitter.emit("userLoopFinish");
    });
    for (let i = 0; i < friends.length; i++) {
	users.get_user_info(friends[i].id, friends_emitter,
			    "userLoopElem", {index: i});
    }
}

/* TODO maybe delete this */
app.get("/api/logout", function(req, res){
    req.session.destroy();
    res.redirect("/");
});

app.get("/quiz", function(req, res) {
    res.send("TODO");
});

app.use(function(err, req, res, next){
    /* generic error handler */
    console.error(err);
    if (err.message == "File too large") {
	/*
	 * this will catch "file too big" errors
	 * I guess I can set flash messages here as well
	 * */
	res.status(500).send("File size is too big. Maximum file size is 2MB");
	return;
    }
    res.status(500).send("Oops, something went wrong: " + err.message);
});

app.listen(app.get("port"), function() {
  console.log("Node app is running on port", app.get("port"));
});
