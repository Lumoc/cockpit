require([
            "selinux/setroubleshoot",
        ],
function(troubleshoot) {
    const app = document.getElementById('app');
    troubleshoot.init(app);
});
