import { SelectIDNodeRed } from './components/SelectID';

function App() {
    return (
        <SelectIDNodeRed
            open
            onclose={(id) => console.log(id)}
            port="8081"
        />
    );
}

export default App;
