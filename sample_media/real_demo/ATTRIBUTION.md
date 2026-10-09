# Real demo set attribution

Images are real photographs from Wikimedia Commons. Licences were read from the Commons API metadata at download time and checked against the allowlist (CC0, CC BY, public domain, MIT, Apache; never NC/ND/SA). Images were only downscaled and cropped; nothing is composited or painted onto them.

Each image is cropped/scaled by sample_media/build_real_demo.py so its grate/debris region (source_roi_px in manifest.json) lands on the default ROI [0.20, 0.40, 0.80, 0.90] of a 640x480 frame. The ROI used is the default.

- empty.jpg (empty): Dump No Waste! Drains to Waterways! - Arlington, MA - DSC05450.jpg; author: Daderot; licence: CC0 (http://creativecommons.org/publicdomain/zero/1.0/deed.en); https://commons.wikimedia.org/wiki/File:Dump_No_Waste!_Drains_to_Waterways!_-_Arlington,_MA_-_DSC05450.jpg
- filling_a.jpg (filling): Q.W.P. 24" Grate - Cambridge, MA.jpg; author: Daderot; licence: CC0 (http://creativecommons.org/publicdomain/zero/1.0/deed.en); https://commons.wikimedia.org/wiki/File:Q.W.P._24%22_Grate_-_Cambridge,_MA.jpg
- filling_b.jpg (filling): "I prefer the bottled stuff," said the storm drain. (25565964563).jpg; author: dankeck; licence: CC0 (http://creativecommons.org/publicdomain/zero/1.0/deed.en); https://commons.wikimedia.org/wiki/File:%22I_prefer_the_bottled_stuff,%22_said_the_storm_drain._(25565964563).jpg
- blocked.jpg (blocked): Storm Drain Clogged - Mid-City New Orleans.jpg; author: Bart Everson; licence: CC BY 2.0 (https://creativecommons.org/licenses/by/2.0); https://commons.wikimedia.org/wiki/File:Storm_Drain_Clogged_-_Mid-City_New_Orleans.jpg
- cleared.jpg (cleared): Storm drain curb inlet San Diego.jpg; author: Mds08011; licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0); https://commons.wikimedia.org/wiki/File:Storm_drain_curb_inlet_San_Diego.jpg
