# get the cdx files
curl 'https://web.archive.org/cdx/search/cdx?url=*.typophile.com' > data/web.archive/001_typophile.com.cdx ;

# process the cdx files and group it by uri
node src/001_groupByURI.js

# get the latest version of the files
node src/002_searchCutOffDate.js

# create the download list
node src/003_createDownloadList.js 

# download the nodes
rm -rf data/web.archive/typophile.com 
mkdir -p data/web.archive/typophile.com/node
sh data/web.archive/004_typophile.com.lastOnline.sh
