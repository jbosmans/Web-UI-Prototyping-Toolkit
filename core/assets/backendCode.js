

(function(window){
    "use strict";
    console.log("Running backendCode.js");

    var $ = window.jQuery;

    $('.protostar-runtime-commands *[data-command]').each(function(){
        var l = $(this);
        l.click(function(evt){
            var commandName = $(evt.target).attr('data-command');
            var clientside = false;
            if($(evt.target).attr('data-type') === 'clientside'){
                clientside = true;
            }
            var inProjectWindow = false;
            if($(evt.target).attr('data-window') === 'project'){
                inProjectWindow = true;
            }
            console.log("Clicked command="+commandName);
            var projectWindow = window.projectWindow;
            var newLoc = false;

            if(clientside){
                try {

                    console.log("COMMANDS = ", protostar);
                    var bcmdn = commandName.substring(commandName.indexOf('/')+1);
                    (protostar.pageCommands[bcmdn])(window, projectWindow);
                } catch (e) {
                    console.error("Error while executing command " + commandName + ": " + e.message, e);
                    throw e;
                }
            }else{
                var needsHandling = false;
                switch (commandName){
                    case 'dxsync_config': window.alert('todo: dxsync_config'); break;
                    case 'dxsync_pull': window.alert('todo: dxsync_pull'); break;
                    case 'wartheme_push': window.alert('todo: wartheme_push'); break;
                    case 'wartheme_pull': window.alert('todo: wartheme_pull'); break;
                    case 'scriptportlet_push_all': window.alert('todo: scriptportlet_push_all'); break;
                    default:
                        console.log("Unknown in-page command: " + commandName);
                        needsHandling = true;
                        break;
                }
                if(needsHandling){
                    var win = window;
                    if(inProjectWindow){
                        win = projectWindow;
                    }
                    win.location = '/?command=' + commandName;
                }
            }
        });
    });
    $('.files-listing *[data-link][data-target]').click(function(){
        var c = $(this);
        var pathname = c.attr('data-link');
        var target = c.attr('data-target');
        if(target === 'project' && window.projectWindow){
            window.projectWindow.location = pathname;
        }else{
            window.location = pathname;
        }
    });
    if($('.ps-config-editor-form').length  >0){

        $.get("/ps/config/config.json").done(function(cfg){
            function getter() {
                var v = cfg;
                for(var i=0; i< arguments.length; i++) {
                    if(!v) return null;
                    v = v[arguments[i]];
                }
                return v;
            }
            console.log("Core config = ", cfg);
            $('.ps-config-editor-form').each(function(){
                var fp = $(this);
                fp.find('input').each(function(){
                    var input = $(this);
                    var name = input.attr('name');
                    if(name.indexOf('.')> 0){
                        input.val(getter.apply(this, name.split('.')));
                    }else{
                        input.val(getter(name));
                    }


                });
            });
        });


    }
})(window);