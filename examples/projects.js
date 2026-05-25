export default {
    projects: [
		{
			type: "zone",
			code: "city",
			state: "city",
			clickable: true,
			left: 1362,
			top: 840,
			width: 80,
			height: 78,
			svg: "city_zone",
		},
        {
			type: "v2",
			code: "city",
			state: "city",
			clickable: true,
			zoom: 1,
			language: ["en"],
			anchor: {
				left: 1437,
				top: 852,
				width: 5,
				height: 5,
			},
			body: {
				left: 1468,
				top: 748,
				width: 124,
				height: 90,
				svg: "city_button",
				scale: true,
			},
			breakpoints: {
				768: {
					body: {
						left: 1496,
						top: 706,
						width: 188.04,
						height: 136.48,
						svg: "city_button_mob",
						scale: true,
					}
				}
			}
		}
    ]
}