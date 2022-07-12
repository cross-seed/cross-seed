import React from "react";
import clsx from "clsx";
import styles from "./styles.module.css";

const FeatureList = [
	{
		title: "Easy to Use",
		description: (
			<>
				It's very easy to get set up with <code>cross-seed</code> if you
				have Docker or Node installed.
			</>
		),
	},
	{
		title: "No false positives",
		description: (
			<>
				<code>cross-seed</code> was designed from the ground up to be as
				low-maintenance as possible; it will never output false
				positives.
			</>
		),
	},
	{
		title: "Daemon Mode",
		description: (
			<>
				Run <code>cross-seed</code> 24/7 to:
				<ul>
					<li>
						Search for cross-seeds as soon as new torrents are
						finished downloading
					</li>
					<li>
						Race starting at 100% before the uploader even joins.
					</li>
				</ul>
			</>
		),
	},
];

function Feature({ title, description }) {
	return (
		<div className={clsx("col col--4")}>
			<div className="text--center padding-horiz--md">
				<h3>{title}</h3>
				<p>{description}</p>
			</div>
		</div>
	);
}

export default function HomepageFeatures() {
	return (
		<section className={styles.features}>
			<div className="container">
				<div className="row">
					{FeatureList.map((props, idx) => (
						<Feature key={idx} {...props} />
					))}
				</div>
			</div>
		</section>
	);
}
