var cheerio = require('cheerio');
var request = require('request');
var fs = require('fs');
var async = require('async');
var _ = require('underscore');
//-------------------------------------------

var $, 
HEADER_AUTH = '--header \"Authorization: Bearer',
HEADER_CT_OCTET_STREAM = '--header \"Content-Type: application/octet-stream',
ENDPOINT_RPC = 'api.dropboxapi.com',
ENDPOINT_CONTENT = 'content.dropboxapi.com',
utils = {
	contains: function(text, sub){
		return (text.indexOf(sub) > -1);
	},
	hasClass: function(className, classText){
		return classText.trim().split(' ').indexOf(className) > -1;
	},
	getTextNode: function(arr){
		var node = _.filter(arr, function(item){
			return item.type === 'text';
		});
		return _.pluck(node, 'data').join(' ').trim();
	}
};

module.exports = generateApiDescription;

//-------------------------------------------

function getAPIDescriptionElems(){
	var resp = $('.documentation__routes');
	var namespaces = _.map(resp.children(), function(sectionChild){
		var namespace = {
			name: sectionChild.attribs.id.replace(/\s/, ''),
		};
		var methodDescWrapElems = _.map(sectionChild.children, function(child, i){
			if(child.attribs && child.attribs.class && utils.hasClass('toc-el', child.attribs.class)){
				return child; 	
			}
		});
		namespace.el = _.compact(methodDescWrapElems);
		return namespace;
	});
	return namespaces;
}

function getTextByElem(el){
	return el.text().trim();
}
function getExampleData(el){
	return el.find('pre').text();
}
function getReturns(el){
	const parametersExample = el.find('.literal-block').eq(0).text();
	let parametersExampleObject = null;
	if(parametersExample.length > 0){
		parametersExampleObject = JSON.parse(parametersExample);
	}
	return parametersExampleObject;
}
function getParameterList(el){

	

	const parametersExample = el.find('.literal-block').eq(0).text();
	let parametersExampleObject = null;
	if(parametersExample.length > 0){
		parametersExampleObject = JSON.parse(parametersExample);
	}

	return {
		list: getParameterListInner(el),
		example: parametersExampleObject
	};

	function getParameterListInner(el){
		return _.map(el.find('.field'), function(item){
			var desc = utils.getTextNode(item.children);
			item = $(item);
			var nestedWrap = item.find('.nested-child');
			if(!!nestedWrap.length){
				const name = item.find('b code').eq(0).text();	
				return {
					name,
					type: item.find('.type').eq(0).text(),
					desc: desc,
					parameters: _.flatten(_.map(nestedWrap, function(item){
						return getParameterList($(item))
					}))
				};
			}else{
				const name = item.find('b code').text();
				return {
					name,
					type: item.find('.type').text(),
					desc: desc
				};				
			}

		});
	}
}

function parseMethodElement(wrap){
	var parsers = {
		'Description': getTextByElem,
		'URL Structure': getTextByElem,
		'Parameters': getParameterList,
		'Returns': getReturns,
		'Endpoint format': function(elem){
			return elem.text().trim().toLowerCase();
		},
		'Example': getExampleData
	};

	var h3 = wrap.find('h3');
	var dl = wrap.find('dl');

	var dds = $(dl).find('dd');
	var dts = $(dl).find('dt');

	var apiMethod = {
		name: h3.text()
	};
	_.each(dts, function(dt, i){
		var name = $(dts[i]).text();
		var valueEl = $(dds[i]);
		if(parsers[name]){
			var value = parsers[name](valueEl);		
			apiMethod[name] = value
		}else{
			// console.log('no parser for', name);
		}
	});
	return apiMethod;
}

function generateApiDescription(cb){
	request('https://www.dropbox.com/developers/documentation/http/documentation', function(err, resp, body){
		if(err){
			console.log('could not retrive documentaion page...');
			return cb ? cb(err) : err;
		}
		parseBody(body);
	});
	//parseBody(fs.readFileSync('api.html'));
	function parseBody(body){
			$ = cheerio.load(body);
			var api = _.map( getAPIDescriptionElems(), function(section){
				return {
					name: section.name,
					methods: _.map(section.el, function(el){
						var methodDescription = parseMethodElement($(el));
						return methodDescription;
					})
				};
			});

			const content = JSON.stringify(parseApiDescription(api), null, '\t');
			if(cb){
				cb(null, content);
			}else{
				fs.writeFileSync('./dist/api.json', content);
			}
			console.log('api description has been generated...');
			
	}
}

function parseApiDescription(apiDescription){
	var parsedApiDescription = {};
	_.each(apiDescription, function(namespace){
		var namespaceName = namespace.name;
		_.each(namespace.methods, function(method){

			var methodName = method.name.substr(1);
			var resourceName = [namespaceName, methodName].join('/');

			var methodUri = method['URL Structure'];
			var methodExample = method['Example'] || null;
			var methodParameters = method['Parameters'] || [];
			var returnParameters = method['Returns'] || null;
			var endpointFormat = method['Endpoint format'] || null;

			var requiresAuthHeader = methodExample === null ? true : utils.contains(methodExample, HEADER_AUTH);
			var requiresReadableStream = methodExample === null ? false : utils.contains(methodExample, HEADER_CT_OCTET_STREAM);
			
			//recognize endpoint
			var endpointType;
			if( utils.contains(methodUri, ENDPOINT_RPC) ){
				endpointType = 'RPC';
			}else if( utils.contains(methodUri, ENDPOINT_CONTENT) ){
				endpointType = 'CONTENT';
			}

			parsedApiDescription[resourceName] = {
				uri: methodUri,
				requiresAuthHeader: requiresAuthHeader,
				requiresReadableStream: requiresReadableStream,
				endpointType: endpointType,
				endpointFormat: endpointFormat,
				parameters: methodParameters,
				returnParameters: returnParameters				
			};
		});
	});
	return parsedApiDescription;
}