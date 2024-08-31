import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

let currentBalance = [{}];
let spreadsheetElement;

function col(obj, column) {
	return obj.map(a => a[column]);
}
function sum(arr) {
	return arr.reduce((a,b) => a+b, 0);
}

function single_investment(balance,base,direction,remaining_amt,depth) {
	// just in case the request is to sell and there is nothing left to sell
	if(direction === -1 && (sum(col(balance,"Balance")) + sum(col(balance,"Adjustment")) <= 0)) {
		return balance;
	}
	let df = structuredClone(balance);

	// if the adjusted current balance < remaining_amt and the request is to sell then sell it all
	if(sum(col(df,"Balance")) + sum(col(df,"Adjustment")) + remaining_amt*direction <= 0) {
		df = df.map((e) => {
			e.Adjustment = e.Balance*-1
			return e;
		});
		return df;
	}

	df = df.map((row) => {
		row.Percent = (row.Balance + row.Adjustment) / (sum(col(df,"Balance")) + sum(col(df,"Adjustment")) + remaining_amt*direction);
		row.DeltaPercent = (row.Percent - row.Target) * direction;
		row.PercentToTarget = (row.Target>0 ? row.DeltaPercent/row.Target : (row.Percent>0 ? (1+row.Percent)*direction : 2.0));
		return row;
	});
	//sort by percent to target
	df.sort((a,b) => {return a.PercentToTarget>b.PercentToTarget?1:(a.PercentToTarget===b.PercentToTarget?0:-1)});

	if(df[0].Balance + df[0].Adjustment <= 0 && direction === -1) {
		console.error('Unable to adjust zero value',df);
		return df;
	}

	if(df[0].Balance + df[0].Adjustment + base * direction <= 0) {
		let adj = base + df[0].Balance+df[0].Adjustment + base * direction;
		df[0].Adjustment = -1*df[0].Balance;
		return single_investment(df,base-adj,direction,remaining_amt-adj,depth+1);
	} else {
		df[0].Adjustment = df[0].Adjustment+base*direction;
	}

	df.sort((a,b) => {return a.Sort>b.Sort?1:(a.Sort===b.Sort?0:-1)});
	const TotalInvestment = sum(col(df,"Adjustment"));
	df = df.map(row => {
		row.TotalInvestment=TotalInvestment;
		row.Percent = (row.Balance + row.Adjustment) / (sum(col(df,"Balance")) + sum(col(df,"Adjustment")));
		return row;
	});
	return df;
}

function invest(balance, amt, base, depth=0) {
	// print('invest:',depth,amt,base,':\n',balance,'\n\n')
	// split amt into direction and remaining_amt to acount for buy/sell direction
	let direction = 1;
	let remaining_amt = amt;
	if(amt < 0) {
		direction = -1;
		remaining_amt *= -1;
	}

	// end if there is nothing left to invest
	if (remaining_amt <= 0.01) {
		return balance;
	}

	// calculate the cutoff at 1000*base except when base = 0.01 then cutoff is to the penny
	// cutoff is used to ensure enough dollars and itterations (i.e. 1k) remain at the next base level
	// the next base will be 10% of the existing base
	let cutoff = base*100;
	if (base <= 0.01) {
		cutoff = 0.01;
		base = 0.01;
	}

	// while remaining_amt > cutoff buy/sell by base increment 
	let updated_balance = balance;
	while(remaining_amt > cutoff || base <= 0.01 && remaining_amt >= base) {
		updated_balance = single_investment(updated_balance,base,direction,remaining_amt,depth+1);
		remaining_amt -= base;
		if(remaining_amt < 0) {
			remaining_amt = 0;
		}
	}
	// Calculate next base level and return it
	return invest(updated_balance,remaining_amt*direction,base/10.0,depth+1)
}

window.addEventListener('load', function () {
	const form = document.getElementById("form");
	const downloadButton = document.getElementById("downloadButton");

	spreadsheetElement = document.getElementById('spreadsheet');
	let myJspreadsheet = jspreadsheet(spreadsheetElement, {
		data:currentBalance,
		columns: [
			{ title: "Label" },
			{ title: "Current Balance", type:'numeric', locale: 'en-US', options: { style:'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 } },
			{ title: "Target %", type:'numeric', mask: "0.00%" },
			{ title: "Sort", type:'numeric' },
			{ title: "Initial",type:'numeric' },
			{ title: "Additional", type:'numeric' },
			{ title:"Buy/Sell", type: "numeric", readOnly:true, locale: 'en-US', options: { style:'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 } },
			{ title: "Percent", type:'numeric', readOnly:true, mask: "0.00%" },
			{ title: "DeltaPercent", type:'numeric', readOnly:true, mask: "0.00%" },
			{ title: "PercentToTarget", type:'numeric', readOnly:true, mask: "0.00%" },
			{ title: "TotalInvestment", type:'numeric', readOnly:true, locale: 'en-US', options: { style:'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 } },
		]
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		// console.log("jspreadsheet",myJspreadsheet.getJson());
		const data = new FormData(event.target);
		let inOut = parseFloat(data.get("investment"));
		let parsed = myJspreadsheet.getJson();
		currentBalance = parsed.map((row,i) => {
			const newRow = {
				"Ticker":row[0],
				"Balance":parseFloat(row[1].replace(/\$|,/g,'')),
				"Target":parseFloat(row[2])/100,
				"Sort":parseInt(i),
				"Initial":parseFloat(row[4]),
				"Additional":parseFloat(row[5])
			}
			return newRow;
		});
		
		currentBalance.forEach((row) => {
			row['Adjustment'] = 0.0
		});
		
		// spreadsheetElement.textContent = '';
		currentBalance = invest(currentBalance, inOut, 1000000);
		console.log("currentBalance", currentBalance);
		myJspreadsheet.setData(currentBalance.map((row) => {
			let newRow = [row.Ticker, row.Balance.toString(), row.Target.toString(), row.Sort, row.Initial, row.Additional, row.Adjustment, row.Percent, row.DeltaPercent, row.PercentToTarget, row.TotalInvestment];
			return newRow;
		}));
		downloadButton.style.display = "unset";
	});

	downloadButton.addEventListener("click", (e) => {
		let table = document.getElementsByClassName("jexcel")[0].outerHTML;
		window.open('data:application/vnd.ms-excel,' + encodeURIComponent(table));
	});
});  